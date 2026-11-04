import { createMarketingEnvironmentAtoms } from "@t3tools/client-runtime/state/marketing";
import { connectionAtomRuntime } from "../connection/runtime";
export const marketingEnvironment = createMarketingEnvironmentAtoms(connectionAtomRuntime);
