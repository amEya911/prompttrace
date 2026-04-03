import * as vscode from 'vscode';

/**
 * Manages extension toggle state, popup preferences, session tracking,
 * first-run detection, and smart popup suppression.
 */
export class StateManager {
  private static ENABLED_KEY = 'prompttrace.enabled';
  private static POPUP_HIDDEN_KEY = 'prompttrace.popupHidden';
  private static POPUP_COOLDOWN_KEY = 'prompttrace.lastPopupTimestamp';
  private static FIRST_RUN_KEY = 'prompttrace.hasShownFirstRun';
  private static LAST_INSIGHT_HASH_KEY = 'prompttrace.lastInsightHash';

  /** Minimum ms between popups to prevent spam */
  private static POPUP_COOLDOWN_MS = 5000;

  /** Minimum token threshold — don't popup for tiny requests */
  private static MIN_TOKEN_THRESHOLD = 100;

  /** Session-level tracking (resets on each activation) */
  private sessionCost = 0;
  private sessionTokens = 0;
  private sessionRequests = 0;

  constructor(private context: vscode.ExtensionContext) { }

  // ─── Toggle ───────────────────────────────────────────

  isEnabled(): boolean {
    return this.context.globalState.get<boolean>(StateManager.ENABLED_KEY, true);
  }

  async setEnabled(val: boolean): Promise<void> {
    await this.context.globalState.update(StateManager.ENABLED_KEY, val);
  }

  async toggleEnabled(): Promise<boolean> {
    const newVal = !this.isEnabled();
    await this.setEnabled(newVal);
    return newVal;
  }

  // ─── Popup Visibility ─────────────────────────────────

  isPopupHidden(): boolean {
    return this.context.globalState.get<boolean>(StateManager.POPUP_HIDDEN_KEY, false);
  }

  async setPopupHidden(val: boolean): Promise<void> {
    await this.context.globalState.update(StateManager.POPUP_HIDDEN_KEY, val);
  }

  // ─── Popup Cooldown + Smart Suppression ───────────────

  /**
   * Determines if a popup should be shown based on:
   * 1. Extension enabled + popups not hidden
   * 2. 5-second cooldown since last popup
   * 3. Token count above minimum threshold
   * 4. Insight hash differs from last shown (no repeated identical popups)
   */
  async canShowPopup(totalTokens: number, insightHash: string): Promise<boolean> {
    if (!this.isEnabled() || this.isPopupHidden()) {
      return false;
    }

    // Smart suppression: skip tiny requests
    // if (totalTokens < StateManager.MIN_TOKEN_THRESHOLD) {
    //   return false;
    // }

    // Smart suppression: skip if exact same insight set was just shown
    // const lastHash = this.context.globalState.get<string>(StateManager.LAST_INSIGHT_HASH_KEY, '');
    // if (lastHash === insightHash && insightHash !== '') {
    //   return false;
    // }

    // Cooldown
    // const lastPopup = this.context.globalState.get<number>(StateManager.POPUP_COOLDOWN_KEY, 0);
    const now = Date.now();
    // if (now - lastPopup < StateManager.POPUP_COOLDOWN_MS) {
    //   return false;
    // }

    await this.context.globalState.update(StateManager.POPUP_COOLDOWN_KEY, now);
    await this.context.globalState.update(StateManager.LAST_INSIGHT_HASH_KEY, insightHash);
    return true;
  }

  // ─── First Run ────────────────────────────────────────

  hasShownFirstRun(): boolean {
    return this.context.globalState.get<boolean>(StateManager.FIRST_RUN_KEY, false);
  }

  async markFirstRunShown(): Promise<void> {
    await this.context.globalState.update(StateManager.FIRST_RUN_KEY, true);
  }

  // ─── Session Tracking ─────────────────────────────────

  addToSession(cost: number, tokens: number): void {
    this.sessionCost += cost;
    this.sessionTokens += tokens;
    this.sessionRequests++;
  }

  getSessionCost(): number {
    return this.sessionCost;
  }

  getSessionTokens(): number {
    return this.sessionTokens;
  }

  getSessionRequests(): number {
    return this.sessionRequests;
  }
}
