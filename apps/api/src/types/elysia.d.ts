declare module "elysia" {
  // Augment Elysia's Context type with application-specific properties
  interface Context {
    auth?: {
      userId: string;
      tenantId: string;
      roles?: string[];
    };
    tenantId?: string;
    clientIp?: string;
    sectorScopeId?: string;
  }
}
