import fs from 'fs';
import path from 'path';
import ts from 'typescript';
test('workout duplicate preserves only supported video overrides and defaults legacy/invalid values to inherit', () => {
  const source = ts.createSourceFile('WorkoutFolderPage.tsx', fs.readFileSync(path.resolve(__dirname, '../../../apps/goarrive/components/WorkoutFolderPage.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  const visit = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'videoPolicy') expression = node.initializer.getText(source); ts.forEachChild(node, visit); }; visit(source);
  expect(expression).not.toBe(''); const clonePolicy = new Function('original', `return (${expression})`);
  for (const policy of ['on', 'off', 'inherit', undefined, null, 'invalid']) expect(clonePolicy({ videoPolicy: policy })).toBe(policy === 'on' || policy === 'off' ? policy : 'inherit');
});
