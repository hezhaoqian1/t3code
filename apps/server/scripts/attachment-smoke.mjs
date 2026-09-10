import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";
import { PDFDocument } from "pdf-lib";

const server = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const root = NodePath.resolve(server, "../..");
const require = NodeModule.createRequire(NodePath.join(root, "scripts/package.json"));
const { createPackageWithOptions } = require("@electron/asar");
const electron = NodeModule.createRequire(NodePath.join(root, "apps/desktop/package.json"))(
  "electron",
);
const bundle = NodePath.resolve(server, process.argv[2] ?? "test-artifacts/attachment-bundle");
const directory = await NodeFSP.mkdtemp(
  NodePath.join(NodePath.dirname(bundle), "attachment-packaged-"),
);
try {
  await NodeFSP.cp(bundle, NodePath.join(directory, "payload"), { recursive: true });
  const archive = NodePath.join(directory, "server.asar");
  await createPackageWithOptions(NodePath.join(directory, "payload"), archive, {});
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 600]).drawText("Attachment smoke revenue 123", { x: 20, y: 500, size: 14 });
  const bytes = await pdf.save();
  const path = NodePath.join(directory, "report.pdf");
  await NodeFSP.writeFile(path, bytes);
  const work = {
    path,
    visual: true,
    attachment: {
      type: "document",
      id: "test",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
    },
  };
  const program = `
    const { Worker } = require('node:worker_threads');
    const worker = new Worker(${JSON.stringify(NodePath.join(archive, "attachmentWorker.mjs"))}, { workerData: ${JSON.stringify(work)} });
    const timer = setTimeout(() => { console.error('worker timed out'); worker.terminate(); process.exitCode = 1; }, 30000);
    worker.once('error', error => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
    worker.once('message', async message => {
      clearTimeout(timer);
      if (!message.ok || message.result.images.length !== 1 || !message.result.context.sections[0].text.includes('revenue 123')) {
        console.error(message.ok ? 'unexpected result' : message.message); process.exitCode = 1;
      } else console.log('PASS: packaged ASAR worker extracted text and rendered PDF pixels');
      await worker.terminate();
    });
  `;
  const code = await new Promise((resolveExit, reject) => {
    const child = NodeChildProcess.spawn(electron, ["-e", program], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  if (code !== 0) process.exitCode = 1;
} finally {
  await NodeFSP.rm(directory, { recursive: true, force: true });
}
