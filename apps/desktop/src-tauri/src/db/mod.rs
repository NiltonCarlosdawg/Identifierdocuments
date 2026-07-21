use rusqlite::{Connection, Result};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

pub const IDENTIFIER_FORMAT_VERSION: u32 = 1;

pub fn build_identifier_string(
    org_prefix: &str,
    cat_prefix: &str,
    year: i32,
    month: u32,
    day: u32,
    seq: u32,
) -> String {
    format!(
        "{}-{}-{:04}-{:02}{:02}-{:03}",
        org_prefix, cat_prefix, year, month, day, seq
    )
}

pub(crate) fn open(db_path: &Path) -> Result<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(db_path)?;
    // Activar foreign keys — sem isto as FK do schema são ignoradas
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    // Restrict file permissions to owner-only (0o600)
    if db_path.parent().is_some() {
        std::fs::set_permissions(db_path, std::fs::Permissions::from_mode(0o600)).ok();
    }
    init_schema(&conn)?;
    Ok(conn)
}

// ============================================================
// Offline persistence invariants
//
// 1. PRAGMA foreign_keys = ON é obrigatório.
//    Definido em open() antes de init_schema(). Sem esta
//    configuração, as FOREIGN KEY do schema são ignoradas.
//
// 2. Toda a geração de identificadores ocorre dentro de
//    transacções SQLite (BEGIN/COMMIT/ROLLBACK). Isto garante
//    que a actualização de next_to_use/next_seq e a inserção
//    em local_pending_identifiers são atómicas.
//
// 3. Um lease com status 'active' é a autoridade exclusiva
//    para geração de identificadores fiscais. A geração só
//    avança next_to_use quando o lease está 'active'.
//
// 4. local_pending_identifiers é a unidade autocontida de
//    sincronização. Cada registo contém toda a informação
//    necessária (category_id, device_id, sector_id, identifier,
//    lease_id, sequence, etc.) para reconstruir a chamada ao
//    backend sem depender de estado em memória.
//
// 5. Leases com status 'remote_released' bloqueiam a geração.
//    O cliente nunca gera identificadores a partir de leases
//    revogados pelo servidor.
//
// 6. O sync não depende de estado em memória. Toda a
//    informação necessária está nas tabelas SQLite.
// ============================================================

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS upload_queue (
            id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            identifier TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS upload_queue_status_idx ON upload_queue(status);

        -- ============================================================
        -- Tabela 1: Cache de categorias
        -- ============================================================
        CREATE TABLE IF NOT EXISTS local_category_cache (
            category_id          TEXT PRIMARY KEY,
            prefix               TEXT NOT NULL,
            requires_sequential  INTEGER NOT NULL DEFAULT 0,
            last_synced_at       TEXT NOT NULL
        );

        -- ============================================================
        -- Tabela 2: Estado do tenant
        -- ============================================================
        CREATE TABLE IF NOT EXISTS local_tenant_state (
            tenant_id        TEXT PRIMARY KEY,
            org_prefix       TEXT NOT NULL DEFAULT 'VL',
            lease_batch_size INTEGER NOT NULL DEFAULT 50,
            last_sync_at     TEXT
        );

        -- ============================================================
        -- Tabela 3: Lease reservado (categorias fiscais)
        -- ============================================================
        CREATE TABLE IF NOT EXISTS local_identifier_lease (
            id          TEXT PRIMARY KEY,
            category_id TEXT NOT NULL,
            device_id   TEXT NOT NULL,
            sector_id   TEXT NOT NULL,
            start_seq   INTEGER NOT NULL CHECK (start_seq > 0),
            end_seq     INTEGER NOT NULL CHECK (end_seq >= start_seq),
            next_to_use INTEGER NOT NULL
                        CHECK (next_to_use >= start_seq AND next_to_use <= end_seq + 1),
            status      TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'remote_released', 'exhausted')),
            created_at  TEXT NOT NULL,

            FOREIGN KEY (category_id) REFERENCES local_category_cache(category_id)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_active_lease
            ON local_identifier_lease(category_id, sector_id)
            WHERE status = 'active';

        CREATE INDEX IF NOT EXISTS idx_lease_category
            ON local_identifier_lease(category_id);

        -- ============================================================
        -- Tabela 4: Contador local para categorias nao-fiscais
        -- ============================================================
        CREATE TABLE IF NOT EXISTS local_loose_counters (
            category_id TEXT NOT NULL,
            sector_id   TEXT NOT NULL,
            next_seq    INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (category_id, sector_id),

            FOREIGN KEY (category_id) REFERENCES local_category_cache(category_id)
        );

        -- ============================================================
        -- Tabela 5: Fila de identificadores offline
        -- ============================================================
        CREATE TABLE IF NOT EXISTS local_pending_identifiers (
            id                TEXT PRIMARY KEY,
            idempotency_key   TEXT NOT NULL,
            category_id       TEXT NOT NULL,
            device_id         TEXT NOT NULL,
            identifier        TEXT NOT NULL,
            sequence          INTEGER,
            lease_id          TEXT,
            issued_to         TEXT,
            description       TEXT,
            visibility        TEXT NOT NULL DEFAULT 'public',
            origin            TEXT NOT NULL DEFAULT 'physical',
            sector_id         TEXT NOT NULL,
            status            TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'synced', 'conflict', 'failed')),
            attempts          INTEGER NOT NULL DEFAULT 0,
            last_error        TEXT,
            conflict_reason   TEXT
                              CHECK (conflict_reason IS NULL OR
                                     conflict_reason IN (
                                         'LEASE_FORCE_RELEASED',
                                         'LEASE_EXPIRED',
                                         'OUT_OF_ORDER',
                                         'CATEGORY_CHANGED',
                                         'SERVER_REJECTED'
                                     )),
            created_at        TEXT NOT NULL,

            FOREIGN KEY (lease_id) REFERENCES local_identifier_lease(id),
            FOREIGN KEY (category_id) REFERENCES local_category_cache(category_id)
        );

        CREATE INDEX IF NOT EXISTS idx_pending_status
            ON local_pending_identifiers(status);

        CREATE INDEX IF NOT EXISTS idx_pending_lease
            ON local_pending_identifiers(lease_id);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_idempotency
            ON local_pending_identifiers(idempotency_key);

        CREATE INDEX IF NOT EXISTS idx_pending_sync
            ON local_pending_identifiers(status, created_at);
        ",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn tmp_db() -> (PathBuf, Connection) {
        let dir = std::env::temp_dir().join(format!("docid_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let conn = open(&db_path).unwrap();
        (dir, conn)
    }

    fn insert_category(conn: &Connection, id: &str, prefix: &str, seq: bool) {
        conn.execute(
            "INSERT INTO local_category_cache (category_id, prefix, requires_sequential, last_synced_at)
             VALUES (?1, ?2, ?3, '2026-07-21T12:00:00Z')",
            rusqlite::params![id, prefix, seq as i32],
        )
        .unwrap();
    }

    fn insert_lease(conn: &Connection, l: &LeaseFixture) {
        conn.execute(
            "INSERT INTO local_identifier_lease (id, category_id, device_id, sector_id, start_seq, end_seq, next_to_use, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '2026-07-21T12:00:00Z')",
            rusqlite::params![l.id, l.category_id, l.device_id, l.sector_id, l.start_seq, l.end_seq, l.next_to_use, l.status],
        )
        .unwrap();
    }

    fn insert_counter(conn: &Connection, cat: &str, sector: &str, next: i32) {
        conn.execute(
            "INSERT INTO local_loose_counters (category_id, sector_id, next_seq)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![cat, sector, next],
        )
        .unwrap();
    }

    fn count_pending(conn: &Connection) -> i32 {
        conn.query_row(
            "SELECT COUNT(*) FROM local_pending_identifiers",
            [],
            |row| row.get(0),
        )
        .unwrap()
    }

    struct LeaseFixture {
        id: String,
        category_id: String,
        device_id: String,
        sector_id: String,
        start_seq: i32,
        end_seq: i32,
        next_to_use: i32,
        status: &'static str,
    }

    // ============================================================
    // Teste 1: build_identifier_parity
    // ============================================================
    #[test]
    fn build_identifier_matches_typescript_fixtures() {
        // Fixtures extraídas do buildIdentifier do servidor TypeScript
        let cases: Vec<(&str, &str, i32, u32, u32, u32, &str)> = vec![
            ("VL", "PROP", 2026, 7, 25, 42, "VL-PROP-2026-0725-042"),
            ("VL", "TST", 2026, 1, 1, 1, "VL-TST-2026-0101-001"),
            ("VL", "PROP", 2026, 12, 31, 999, "VL-PROP-2026-1231-999"),
            ("VERANO", "DOC", 2026, 7, 25, 1, "VERANO-DOC-2026-0725-001"),
            ("A", "B", 2026, 7, 5, 7, "A-B-2026-0705-007"),
            ("VL", "PROP", 2026, 7, 25, 1000, "VL-PROP-2026-0725-1000"),
            ("VL", "PROP", 2026, 7, 25, 12345, "VL-PROP-2026-0725-12345"),
        ];

        for (org, cat, y, m, d, seq, expected) in cases {
            let got = build_identifier_string(org, cat, y, m, d, seq);
            assert_eq!(
                got, expected,
                "buildIdentifier({org}, {cat}, {y}, {m}, {d}, {seq})"
            );
        }
    }

    // ============================================================
    // Teste 2: fiscal_uses_lease + Teste 3: non_fiscal_uses_counter
    // são testados em commands/identifiers.rs (precisam da lógica de
    // generate_offline_identifier, que está no módulo de comandos)
    //
    // Aqui testamos apenas a persistência e constraints do schema.
    // ============================================================

    // ============================================================
    // Teste 4: lease_sequential_consumption (persistência do next_to_use)
    // ============================================================
    #[test]
    fn lease_next_to_use_increments() {
        let (_dir, conn) = tmp_db();
        insert_category(&conn, "cat-fiscal", "FISC", true);
        insert_lease(
            &conn,
            &LeaseFixture {
                id: "l1".into(),
                category_id: "cat-fiscal".into(),
                device_id: "dev-1".into(),
                sector_id: "s1".into(),
                start_seq: 1,
                end_seq: 50,
                next_to_use: 1,
                status: "active",
            },
        );

        // Simular 3 consumos: cada um incrementa next_to_use
        for _ in 0..3 {
            conn.execute(
                "UPDATE local_identifier_lease SET next_to_use = next_to_use + 1 WHERE id = 'l1'",
                [],
            )
            .unwrap();
        }

        let final_val: i32 = conn
            .query_row(
                "SELECT next_to_use FROM local_identifier_lease WHERE id = 'l1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(final_val, 4);
    }

    // ============================================================
    // Teste 5: lease_exhausted — CHECK rejeita next_to_use > end_seq + 1
    // ============================================================
    #[test]
    fn lease_check_rejects_invalid_next_to_use() {
        let (_dir, conn) = tmp_db();
        insert_category(&conn, "cat-fiscal", "FISC", true);
        insert_lease(
            &conn,
            &LeaseFixture {
                id: "l1".into(),
                category_id: "cat-fiscal".into(),
                device_id: "dev-1".into(),
                sector_id: "s1".into(),
                start_seq: 1,
                end_seq: 1,
                next_to_use: 1,
                status: "active",
            },
        );

        // Consumir a única sequência: next_to_use = 2 (permitido: <= end_seq + 1)
        conn.execute(
            "UPDATE local_identifier_lease SET next_to_use = 2 WHERE id = 'l1'",
            [],
        )
        .unwrap();

        // Tentar next_to_use = 3 (viola CHECK: <= end_seq + 1 = 2)
        let result = conn.execute(
            "UPDATE local_identifier_lease SET next_to_use = 3 WHERE id = 'l1'",
            [],
        );
        assert!(
            result.is_err(),
            "CHECK deve rejeitar next_to_use > end_seq + 1"
        );
    }

    // ============================================================
    // Teste 6: loose_counter_persists_across_reopen
    // ============================================================
    #[test]
    fn loose_counter_survives_reopen() {
        let dir = std::env::temp_dir().join(format!("docid_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");

        // --- Primeira sessão ---
        {
            let conn = open(&db_path).unwrap();
            insert_category(&conn, "cat-loose", "LOOSE", false);
            insert_counter(&conn, "cat-loose", "s1", 1);

            // Consumir 3: next_seq 1→2→3→4
            for _ in 0..3 {
                conn.execute(
                    "UPDATE local_loose_counters SET next_seq = next_seq + 1
                     WHERE category_id = 'cat-loose' AND sector_id = 's1'",
                    [],
                )
                .unwrap();
            }
        } // conn dropped (fecha BD)

        // --- Segunda sessão (reabrir) ---
        let conn2 = open(&db_path).unwrap();
        let val: i32 = conn2
            .query_row(
                "SELECT next_seq FROM local_loose_counters
                 WHERE category_id = 'cat-loose' AND sector_id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(val, 4);

        fs::remove_dir_all(&dir).ok();
    }

    // ============================================================
    // Teste 7: idempotency_key_generated — verificar que o campo existe
    // e pode ser inserido (teste real da geração fica no commands)
    // ============================================================
    #[test]
    fn idempotency_key_stored_on_insert() {
        let (_dir, conn) = tmp_db();
        insert_category(&conn, "cat-fiscal", "FISC", true);
        insert_lease(
            &conn,
            &LeaseFixture {
                id: "l1".into(),
                category_id: "cat-fiscal".into(),
                device_id: "dev-1".into(),
                sector_id: "s1".into(),
                start_seq: 1,
                end_seq: 50,
                next_to_use: 1,
                status: "active",
            },
        );

        let idem_key = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO local_pending_identifiers
                (id, idempotency_key, category_id, device_id, identifier, sequence, lease_id,
                 sector_id, status, created_at)
             VALUES (?1, ?2, 'cat-fiscal', 'dev-1', 'VL-FISC-2026-0721-001', 1, 'l1',
                     's1', 'pending', '2026-07-21T12:00:00Z')",
            rusqlite::params![uuid::Uuid::new_v4().to_string(), idem_key],
        )
        .unwrap();

        let stored: String = conn
            .query_row(
                "SELECT idempotency_key FROM local_pending_identifiers WHERE idempotency_key = ?1",
                rusqlite::params![idem_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, idem_key);
    }

    // ============================================================
    // Teste 8: conflict_reason_persisted
    // ============================================================
    #[test]
    fn conflict_reason_is_stored_and_retrieved() {
        let (_dir, conn) = tmp_db();
        insert_category(&conn, "cat-fiscal", "FISC", true);

        let reasons = [
            "LEASE_FORCE_RELEASED",
            "LEASE_EXPIRED",
            "OUT_OF_ORDER",
            "CATEGORY_CHANGED",
            "SERVER_REJECTED",
        ];

        for reason in &reasons {
            conn.execute(
                "INSERT INTO local_pending_identifiers
                    (id, idempotency_key, category_id, device_id, identifier, sequence,
                     sector_id, status, conflict_reason, created_at)
                 VALUES (?1, ?2, 'cat-fiscal', 'dev-1', 'TST', 1,
                         's1', 'conflict', ?3, '2026-07-21T12:00:00Z')",
                rusqlite::params![
                    uuid::Uuid::new_v4().to_string(),
                    uuid::Uuid::new_v4().to_string(),
                    reason,
                ],
            )
            .unwrap();
        }

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM local_pending_identifiers WHERE status = 'conflict'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 5);
    }

    // ============================================================
    // Teste 9: schema constraints rejeitam valores inválidos
    // ============================================================
    #[test]
    fn check_constraints_reject_invalid_status() {
        let (_dir, conn) = tmp_db();
        insert_category(&conn, "cat-fiscal", "FISC", true);

        // Status inválido em local_pending_identifiers
        let result = conn.execute(
            "INSERT INTO local_pending_identifiers
                (id, idempotency_key, category_id, device_id, identifier, sequence,
                 sector_id, status, created_at)
             VALUES ('x', 'y', 'cat-fiscal', 'dev-1', 'TST', 1,
                     's1', 'invalid_status', '2026-07-21T12:00:00Z')",
            [],
        );
        assert!(
            result.is_err(),
            "CHECK deve rejeitar status='invalid_status'"
        );

        // Status inválido em local_identifier_lease
        insert_category(&conn, "cat-fiscal-2", "FISC2", true);
        let result = conn.execute(
            "INSERT INTO local_identifier_lease
                (id, category_id, device_id, sector_id, start_seq, end_seq, next_to_use, status, created_at)
             VALUES ('y', 'cat-fiscal-2', 'dev-1', 's1', 1, 10, 1, 'bogus', '2026-07-21T12:00:00Z')",
            [],
        );
        assert!(
            result.is_err(),
            "CHECK deve rejeitar status='bogus' no lease"
        );
    }

    // ============================================================
    // Teste 10: generation_is_atomic_after_crash
    // ============================================================
    #[test]
    fn partial_transaction_does_not_leak_on_rollback() {
        let dir = std::env::temp_dir().join(format!("docid_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");

        // --- Sessão 1: iniciar transação, escrever, fazer rollback ---
        {
            let conn = open(&db_path).unwrap();
            insert_category(&conn, "cat-fiscal", "FISC", true);
            insert_lease(
                &conn,
                &LeaseFixture {
                    id: "l-crash".into(),
                    category_id: "cat-fiscal".into(),
                    device_id: "dev-1".into(),
                    sector_id: "s1".into(),
                    start_seq: 1,
                    end_seq: 50,
                    next_to_use: 1,
                    status: "active",
                },
            );

            // Transação: actualizar next_to_use mas rollback ANTES de inserir pending
            conn.execute("BEGIN", []).unwrap();
            conn.execute(
                "UPDATE local_identifier_lease SET next_to_use = 43 WHERE id = 'l-crash'",
                [],
            )
            .unwrap();
            // Simular crash: rollback em vez de commit
            conn.execute("ROLLBACK", []).unwrap();
        } // sessão 1 fechada

        // --- Sessão 2: reabrir e verificar estado ---
        {
            let conn = open(&db_path).unwrap();
            let next: i32 = conn
                .query_row(
                    "SELECT next_to_use FROM local_identifier_lease WHERE id = 'l-crash'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            // Deve ter revertido para 1 (não 43)
            assert_eq!(next, 1, "ROLLBACK deve reverter next_to_use");

            let pending = count_pending(&conn);
            assert_eq!(pending, 0, "ROLLBACK não deve deixar pending identifiers");
        }

        // --- Sessão 3: provar que o lease continua utilizável ---
        {
            let conn = open(&db_path).unwrap();
            conn.execute(
                "UPDATE local_identifier_lease SET next_to_use = 2 WHERE id = 'l-crash'",
                [],
            )
            .unwrap();
            let next: i32 = conn
                .query_row(
                    "SELECT next_to_use FROM local_identifier_lease WHERE id = 'l-crash'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(next, 2, "lease deve continuar utilizável após rollback");
        }

        // --- Mesmo teste para contador loose ---
        {
            let conn = open(&db_path).unwrap();
            insert_category(&conn, "cat-loose", "LOOSE", false);
            insert_counter(&conn, "cat-loose", "s1", 10);

            conn.execute("BEGIN", []).unwrap();
            conn.execute(
                "UPDATE local_loose_counters SET next_seq = 15
                 WHERE category_id = 'cat-loose' AND sector_id = 's1'",
                [],
            )
            .unwrap();
            conn.execute("ROLLBACK", []).unwrap();
        }

        {
            let conn = open(&db_path).unwrap();
            let next: i32 = conn
                .query_row(
                    "SELECT next_seq FROM local_loose_counters
                     WHERE category_id = 'cat-loose' AND sector_id = 's1'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(next, 10, "counter deve reverter para 10 após rollback");
        }

        fs::remove_dir_all(&dir).ok();
    }

    // ============================================================
    // Teste extra: FK constraint rejeita lease para categoria inexistente
    // ============================================================
    #[test]
    fn foreign_key_rejects_missing_category() {
        let (_dir, conn) = tmp_db();
        let result = conn.execute(
            "INSERT INTO local_identifier_lease
                (id, category_id, device_id, sector_id, start_seq, end_seq, next_to_use, status, created_at)
             VALUES ('x', 'nonexistent-cat', 'dev-1', 's1', 1, 10, 1, 'active', '2026-07-21T12:00:00Z')",
            [],
        );
        assert!(
            result.is_err(),
            "FK deve rejeitar lease sem categoria na cache"
        );
    }

    #[test]
    fn foreign_key_rejects_lease_id_not_in_leases() {
        let (_dir, conn) = tmp_db();
        insert_category(&conn, "cat-loose", "LOOSE", false);

        let result = conn.execute(
            "INSERT INTO local_pending_identifiers
                (id, idempotency_key, category_id, device_id, identifier, sequence, lease_id,
                 sector_id, status, created_at)
             VALUES ('x', 'y', 'cat-loose', 'dev-1', 'TST', 1, 'nonexistent-lease',
                     's1', 'pending', '2026-07-21T12:00:00Z')",
            [],
        );
        assert!(
            result.is_err(),
            "FK deve rejeitar lease_id que nao existe em local_identifier_lease"
        );
    }
}
