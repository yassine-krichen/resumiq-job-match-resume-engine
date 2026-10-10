import { formatPlaybook, learn, readPlaybook, removeEntry } from '../playbooks/playbook';
import type { PlaybookAgent } from '../playbooks/playbook';

import type { Context } from './context';

// `learn` is what an agent runs to record a workaround for the next run; `playbook` is the owner's list/prune.
// Only the validator-approved text ever reaches playbooks/<agent>.md.

export async function learnCommand(
  context: Context,
  options: { agent: PlaybookAgent; situation: string | undefined; fix: string | undefined },
  today: string = new Date().toISOString().slice(0, 10),
): Promise<string> {
  const result = await learn(context.paths.root, options.agent, { situation: options.situation, fix: options.fix }, today);
  switch (result.status) {
    case 'added':
      return `Recorded entry ${result.entry.number} in the ${options.agent} playbook.`;
    case 'duplicate':
      return `Already known: entry ${result.entry.number} of the ${options.agent} playbook, now seen ${result.entry.seen} times.`;
    case 'rejected':
      throw new Error(`learn refused (nothing was saved): ${result.errors.join('; ')}`);
    case 'full':
      throw new Error(
        `The ${options.agent} playbook is full (${result.limit} entries). Nothing was saved; the owner prunes it with: ` +
          `npm run outreach -- playbook --agent ${options.agent} --remove <n>`,
      );
  }
}

export async function playbookCommand(context: Context, options: { agent: PlaybookAgent; remove?: number }): Promise<string> {
  if (options.remove === undefined) return formatPlaybook(options.agent, await readPlaybook(context.paths.root, options.agent));
  const removed = await removeEntry(context.paths.root, options.agent, options.remove);
  if (!removed) throw new Error(`The ${options.agent} playbook has no entry ${options.remove}`);
  return `Removed entry ${removed.number} of the ${options.agent} playbook:\n  ${removed.situation} => ${removed.fix}`;
}
