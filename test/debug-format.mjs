import { formatConflictWarning } from '../src/utils/conflict-detect.ts';
const entry = {
  id: 1, absolutePath: '/a.txt', displayPath: 'a.txt',
  startLine: 2, separatorLine: 4, endLine: 6,
  oursLabel: 'HEAD', theirsLabel: 'feat',
  oursLines: ['ours-line'], theirsLines: ['theirs-line'],
};
const out = formatConflictWarning([entry]);
process.stdout.write(out.slice(0, 200));
