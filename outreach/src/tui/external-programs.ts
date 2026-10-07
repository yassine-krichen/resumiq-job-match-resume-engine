import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The two things the screen hands to the operating system: the user's editor and the PDF viewer.

export interface LaunchCommand {
  command: string;
  args: string[];
  verbatim: boolean;
}

/**
 * How to open a file with its default program. On Windows this is `start "" "<file>"` through cmd; the empty
 * title keeps `start` from treating the quoted path as a window title, and the verbatim flag stops Node from
 * re-escaping the quotes.
 */
export function openFileCommand(file: string, platform: NodeJS.Platform = process.platform): LaunchCommand {
  if (platform === 'win32') {
    return { command: 'cmd.exe', args: ['/c', 'start', '""', `"${file}"`], verbatim: true };
  }
  return { command: platform === 'darwin' ? 'open' : 'xdg-open', args: [file], verbatim: false };
}

/** Opens a file (or an https URL) with the system default program, detached from this process. */
export function openFile(file: string): void {
  const { command, args, verbatim } = openFileCommand(file);
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: verbatim });
  child.on('error', () => undefined);
  child.unref();
}

/** `$VISUAL`, then `$EDITOR`, then VS Code. The command may carry flags, so it runs through the shell. */
export function editorCommand(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.VISUAL?.trim() || env.EDITOR?.trim();
  return configured || 'code --wait';
}

/**
 * Writes `initialText` to a temp file, runs the editor on it until it exits and returns what was saved.
 * The temp folder is removed either way. The caller must have released the terminal first.
 */
export async function editInEditor(initialText: string, name: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'outreach-edit-'));
  const file = join(directory, `${name.replace(/[^\w.-]/g, '_')}.txt`);
  try {
    await writeFile(file, initialText, 'utf-8');
    const result = spawnSync(`${editorCommand(env)} "${file}"`, { shell: true, stdio: 'inherit' });
    if (result.error) throw new Error(`Could not start the editor: ${result.error.message}. Set $EDITOR.`);
    if (result.status !== 0) throw new Error(`The editor exited with code ${result.status ?? 'unknown'}. Nothing was saved.`);
    return await readFile(file, 'utf-8');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
