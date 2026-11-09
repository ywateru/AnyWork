import LogtoClient, { BrowserStorage, type LogtoConfig } from "@logto/browser";
import { accountStorageNamespace, type AccountConfig } from "./accountConfig";

/** Keep the official browser adapter, isolating persisted grants across issuers. */
export class AccountLogtoClient extends LogtoClient {
  constructor(config: LogtoConfig, account: AccountConfig) {
    super(config);
    // Official client defers persisted token reads to first use, explicitly allowing
    // subclasses to replace adapter.storage in their constructor.
    this.adapter.storage = new BrowserStorage(accountStorageNamespace(account));
  }
}
