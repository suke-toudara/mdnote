// Excel / スプレッドシートからコピーしたタブ区切りテキストを Markdown の表に変換する。

export function looksLikeTsv(text: string): boolean {
  const rows = text.replace(/\r?\n$/, '').split(/\r?\n/);
  if (rows.length < 2) return false;
  const cols = rows[0].split('\t').length;
  return cols >= 2 && rows.every((r) => r.split('\t').length === cols);
}

function escapeCell(cell: string) {
  return cell.trim().replace(/\|/g, '\\|');
}

export function tsvToMarkdownTable(text: string): string {
  const rows = text
    .replace(/\r?\n$/, '')
    .split(/\r?\n/)
    .map((r) => r.split('\t').map(escapeCell));
  const [header, ...body] = rows;
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...body.map(line)].join('\n');
}
