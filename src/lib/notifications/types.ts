/**
 * Notification Types
 */

export type NotificationChannel = "in_app" | "email" | "telegram";

export interface NotificationSubscription {
  userAddress: string;
  email?: string;
  telegramChatId?: string;
  channels: NotificationChannel[];
  minTrustScore: number;
  minClusterSize: number;
  chainFilter: ("solana" | "base")[];
  tokenFilter: string[];
  maxAlertsPerHour: number;
  isActive: boolean;
}

export interface NotificationJob {
  id: string;
  userAddress: string;
  alertId: string;
  channel: NotificationChannel;
  payload: ClusterNotificationPayload;
  createdAt: number;
}

export interface ClusterNotificationPayload {
  chain: "solana" | "base";
  tokenAddress: string;
  tokenSymbol?: string;
  clusterSize: number;
  avgTrustScore: number;
  traders: Array<{
    walletAddress: string;
    traderId?: string;
    trustScore?: number;
  }>;
}
