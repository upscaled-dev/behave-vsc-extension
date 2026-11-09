const vscode = require("vscode");
exports.activate = (context) => {
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory("debugpy", {
    createDebugAdapterDescriptor(session) {
      return new vscode.DebugAdapterExecutable(session.configuration.python, ["-m", "debugpy.adapter"]);
    },
  }));
};
