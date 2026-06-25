// Store factory. The rest of the app imports `db` from here and never knows
// which backend it is. To move to Postgres later: implement a postgres.js with
// the SAME methods as memory.js, then add a case below. Zero route changes.

import { config } from "../config/index.js";
import { memoryStore } from "./memory.js";

function selectStore() {
  switch (config.dataStore) {
    case "memory":
      return memoryStore;
    case "postgres":
      // return postgresStore;  // implement store/postgres.js with identical methods
      throw new Error("postgres store not implemented yet — set DATA_STORE=memory");
    default:
      return memoryStore;
  }
}

export const db = selectStore();
