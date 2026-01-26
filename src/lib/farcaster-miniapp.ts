/**
 * Farcaster Mini App SDK integration
 * Handles SDK initialization, context, and actions
 */

import sdk from "@farcaster/frame-sdk";

export interface MiniAppUser {
  fid: number;
  username?: string;
  displayName?: string;
  pfpUrl?: string;
}

export interface MiniAppState {
  isReady: boolean;
  isInMiniApp: boolean;
  user: MiniAppUser | null;
  added: boolean;
  safeAreaInsets: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

const DEFAULT_SAFE_AREA = { top: 0, bottom: 0, left: 0, right: 0 };

class FarcasterMiniApp {
  private state: MiniAppState = {
    isReady: false,
    isInMiniApp: false,
    user: null,
    added: false,
    safeAreaInsets: DEFAULT_SAFE_AREA,
  };

  private listeners: Set<(state: MiniAppState) => void> = new Set();

  async initialize(): Promise<MiniAppState> {
    if (typeof window === "undefined") return this.state;

    try {
      const context = await sdk.context;

      if (!context) {
        this.state.isInMiniApp = false;
        return this.state;
      }

      this.state = {
        isReady: false,
        isInMiniApp: true,
        user: context.user
          ? {
              fid: context.user.fid,
              username: context.user.username,
              displayName: context.user.displayName,
              pfpUrl: context.user.pfpUrl,
            }
          : null,
        added: context.client?.added ?? false,
        safeAreaInsets: context.client?.safeAreaInsets || DEFAULT_SAFE_AREA,
      };

      this.notifyListeners();
      return this.state;
    } catch {
      this.state.isInMiniApp = false;
      return this.state;
    }
  }

  async ready(): Promise<void> {
    if (!this.state.isInMiniApp) return;

    try {
      await sdk.actions.ready();
      this.state.isReady = true;
      this.notifyListeners();
    } catch (error) {
      console.error("[MiniApp] Failed to signal ready:", error);
    }
  }

  async close(): Promise<void> {
    if (!this.state.isInMiniApp) return;
    await sdk.actions.close();
  }

  async composeCast(options: {
    text?: string;
    embeds?: [string] | [string, string];
  }): Promise<void> {
    if (!this.state.isInMiniApp) {
      const embedParam = options.embeds?.[0]
        ? `&embeds[]=${encodeURIComponent(options.embeds[0])}`
        : "";
      window.open(
        `https://warpcast.com/~/compose?text=${encodeURIComponent(options.text || "")}${embedParam}`,
        "_blank"
      );
      return;
    }
    await sdk.actions.composeCast(options);
  }

  async openUrl(url: string): Promise<void> {
    if (!this.state.isInMiniApp) {
      window.open(url, "_blank");
      return;
    }
    await sdk.actions.openUrl(url);
  }

  async viewProfile(fid: number): Promise<void> {
    if (!this.state.isInMiniApp) {
      window.open(`https://warpcast.com/~/profiles/${fid}`, "_blank");
      return;
    }
    await sdk.actions.viewProfile({ fid });
  }

  async addMiniApp(): Promise<{ added: boolean }> {
    if (!this.state.isInMiniApp) {
      return { added: false };
    }
    try {
      await sdk.actions.addMiniApp();
      this.state.added = true;
      this.notifyListeners();
      return { added: true };
    } catch (error) {
      console.error("[MiniApp] Failed to add:", error);
      return { added: false };
    }
  }

  getState(): MiniAppState {
    return this.state;
  }

  subscribe(listener: (state: MiniAppState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }
}

export const miniApp = new FarcasterMiniApp();
