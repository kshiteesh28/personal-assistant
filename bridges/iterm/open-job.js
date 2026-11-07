// The command is generated from validated fixed argv by the core, never raw speech.
function run(argv) {
  if (argv.length !== 1) throw Error('One managed-display command is required.');
  const app = Application('com.googlecode.iterm2');
  const window = app.createWindowWithDefaultProfile({ command: argv[0] });
  return JSON.stringify({ status: 'opened', windowId: window.id(), sessionId: window.currentSession().id() });
}
