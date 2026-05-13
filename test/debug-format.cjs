(async () => {
  const { formatConflictWarning } = await import('./src/utils/conflict-detect.ts');
  const entry = {
    id: 1, absolutePath: '/a.txt', displayPath: 'a.txt',
    startLine: 2, separatorLine: 4, endLine: 6,
    oursLabel: 'HEAD', theirsLabel: 'feat',
    oursLines: ['ours-line'], theirsLines: ['theirs-line'],
  };
  const out = formatConflictWarning([entry]);
  console.log('OUTPUT:');
  console.log(out.slice(0, 300));
})();
