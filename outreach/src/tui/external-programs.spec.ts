import { editorCommand, openFileCommand } from './external-programs';

describe('openFileCommand', () => {
  it('uses `start "" "<file>"` through cmd on Windows, verbatim so the empty title survives', () => {
    expect(openFileCommand('C:\\work\\my resumes\\Jane-Doe-Resume.pdf', 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/c', 'start', '""', '"C:\\work\\my resumes\\Jane-Doe-Resume.pdf"'],
      verbatim: true,
    });
  });

  it('uses open on macOS and xdg-open elsewhere', () => {
    expect(openFileCommand('/tmp/a.pdf', 'darwin').command).toBe('open');
    expect(openFileCommand('/tmp/a.pdf', 'linux')).toEqual({ command: 'xdg-open', args: ['/tmp/a.pdf'], verbatim: false });
  });
});

describe('editorCommand', () => {
  it('prefers $VISUAL, then $EDITOR, then VS Code waiting for the window to close', () => {
    expect(editorCommand({ VISUAL: 'nvim', EDITOR: 'nano' })).toBe('nvim');
    expect(editorCommand({ EDITOR: 'nano -w' })).toBe('nano -w');
    expect(editorCommand({})).toBe('code --wait');
    expect(editorCommand({ VISUAL: '  ', EDITOR: '' })).toBe('code --wait');
  });
});
