import { Command } from "commander";
import { listOps, getOp } from "../lib/ops/registry";
import { safeLog } from "../lib/redact";

export function opsCommand(): Command {
  const cmd = new Command("ops").description("List and describe registered op types (capability catalog)");

  cmd
    .command("list")
    .description("List all registered op types")
    .action(() => {
      const ops = listOps().map((o) => ({ type: o.type, summary: o.summary }));
      safeLog(ops);
    });

  cmd
    .command("describe")
    .argument("<type>", "Op type to describe")
    .description("Show full schema and example for an op type")
    .action((type: string) => {
      const op = getOp(type);
      if (!op) {
        safeLog({ ok: false, error: { code: "UNKNOWN_OP_TYPE", message: `Unknown op type: ${type}` } });
        process.exitCode = 1;
        return;
      }
      safeLog(op.describe());
    });

  return cmd;
}
