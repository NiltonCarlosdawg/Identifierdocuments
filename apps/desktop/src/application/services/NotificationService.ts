import type { IApiClient } from "../ports/IApiClient";
import type { AppNotification } from "../../domain/entities/Notification";

export class NotificationService {
  constructor(private readonly api: IApiClient) {}
  async fetchNotifications(limit = 30): Promise<AppNotification[]> {
    const res = await this.api.get<{ data: AppNotification[] }>(`/notifications?limit=${limit}`);
    return res.data || [];
  }
  async markAsRead(id: string): Promise<void> { await this.api.patch(`/notifications/${id}/read`, {}); }
}
