import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { PDFDocument } from 'pdf-lib';
import { TypstRenderer } from './typst-renderer';
import { buildTypstDocument } from './content-builder';
import type { AISelection, MasterDB } from '@resumiq/ai-bridge';

jest.mock('child_process');
jest.mock('fs/promises');
jest.mock('pdf-lib');
jest.mock('./content-builder');

const spawnMock = spawn as unknown as jest.Mock;
const mkdirMock = mkdir as unknown as jest.Mock;
const writeFileMock = writeFile as unknown as jest.Mock;
const readFileMock = readFile as unknown as jest.Mock;
const rmMock = rm as unknown as jest.Mock;
const loadMock = PDFDocument.load as unknown as jest.Mock;
const buildTypstDocumentMock = buildTypstDocument as unknown as jest.Mock;

/** Fake `typst compile` child process that exits with the given code on next tick. */
function fakeSpawn(code: number, stderrText = ''): EventEmitter & { stderr: EventEmitter } {
  const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (stderrText) proc.stderr.emit('data', Buffer.from(stderrText));
    proc.emit('close', code);
  });
  return proc;
}

/** Fake spawn that fails to launch at all (binary missing / not on PATH). */
function fakeSpawnLaunchError(message: string): EventEmitter & { stderr: EventEmitter } {
  const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
  proc.stderr = new EventEmitter();
  setImmediate(() => proc.emit('error', new Error(message)));
  return proc;
}

const selection = {} as AISelection;
const db = {} as MasterDB;

describe('TypstRenderer.render — auto-shrink fit loop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(Buffer.from('pdf-bytes'));
    rmMock.mockResolvedValue(undefined);
    buildTypstDocumentMock.mockReturnValue(
      'DOC[font=%%FONT_SIZE%%,leading=%%LEADING%%,item=%%ITEM_SPACING%%,gap=%%SECTION_GAP%%]',
    );
  });

  it('compiles once and stops immediately when the first attempt already fits one page', async () => {
    spawnMock.mockImplementation(() => fakeSpawn(0));
    loadMock.mockResolvedValue({ getPageCount: () => 1 });

    const renderer = new TypstRenderer();
    const result = await renderer.render(selection, db, 'default');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(result.pageCount).toBe(1);
    // First shrink-ladder step: 11pt.
    expect(result.source).toContain('font=11');
  });

  it('steps down font size and spacing and recompiles until the resume fits one page', async () => {
    spawnMock.mockImplementation(() => fakeSpawn(0));
    loadMock
      .mockResolvedValueOnce({ getPageCount: () => 2 })
      .mockResolvedValueOnce({ getPageCount: () => 1 });

    const renderer = new TypstRenderer();
    const result = await renderer.render(selection, db, 'default');

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(result.pageCount).toBe(1);
    // Second shrink-ladder step: 10.5pt.
    expect(result.source).toContain('font=10.5');
  });

  it('returns the true final page count — still >1 — when the shrink budget is exhausted, never lying about fit', async () => {
    spawnMock.mockImplementation(() => fakeSpawn(0));
    loadMock.mockResolvedValue({ getPageCount: () => 2 });

    const renderer = new TypstRenderer();
    const result = await renderer.render(selection, db, 'default');

    // All 4 shrink-ladder steps attempted, none fit — renderer does not fabricate a fit.
    expect(spawnMock).toHaveBeenCalledTimes(4);
    expect(result.pageCount).toBe(2);
    // Smallest ladder step: 9.5pt — confirms the loop ran to exhaustion, not an early bail.
    expect(result.source).toContain('font=9.5');
  });

  it('rejects when the typst binary cannot be spawned', async () => {
    spawnMock.mockImplementation(() => fakeSpawnLaunchError('ENOENT'));

    const renderer = new TypstRenderer();

    await expect(renderer.render(selection, db, 'default')).rejects.toThrow(
      /Failed to spawn typst/,
    );
  });

  it('rejects with compiler stderr when typst exits non-zero', async () => {
    spawnMock.mockImplementation(() => fakeSpawn(1, 'undefined variable: skeleton'));

    const renderer = new TypstRenderer();

    await expect(renderer.render(selection, db, 'default')).rejects.toThrow(
      /typst exited with code 1/,
    );
  });

  it('always cleans up the temp work directory, even when compilation fails', async () => {
    spawnMock.mockImplementation(() => fakeSpawn(1, 'boom'));

    const renderer = new TypstRenderer();
    await expect(renderer.render(selection, db, 'default')).rejects.toThrow();

    expect(rmMock).toHaveBeenCalledTimes(1);
    expect(rmMock.mock.calls[0][1]).toEqual({ recursive: true, force: true });
  });

  it('cleans up the temp work directory after a successful render too', async () => {
    spawnMock.mockImplementation(() => fakeSpawn(0));
    loadMock.mockResolvedValue({ getPageCount: () => 1 });

    const renderer = new TypstRenderer();
    await renderer.render(selection, db, 'default');

    expect(rmMock).toHaveBeenCalledTimes(1);
  });
});
