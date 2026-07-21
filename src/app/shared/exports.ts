// Multi-format export helpers (dependency-free).
export { downloadCsv } from './export-csv';

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Excel-compatible SpreadsheetML workbook (.xls) — opens natively in Excel. */
export function downloadXls(name: string, headers: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) =>
    typeof v === 'number'
      ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
      : `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`;
  const hdr = (v: string) => `<Cell ss:StyleID="h"><Data ss:Type="String">${esc(v)}</Data></Cell>`;
  const xml =
    `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#0d9488" ss:Pattern="Solid"/></Style></Styles>` +
    `<Worksheet ss:Name="Export"><Table>` +
    `<Row>${headers.map(hdr).join('')}</Row>` +
    rows.map((r) => `<Row>${r.map(cell).join('')}</Row>`).join('') +
    `</Table></Worksheet></Workbook>`;
  triggerDownload(name.endsWith('.xls') ? name : `${name}.xls`, xml, 'application/vnd.ms-excel');
}

/** Open a print-ready view of the table; user saves as PDF. */
export function exportPdf(title: string, headers: string[], rows: (string | number)[][]) {
  const w = window.open('', '_blank');
  if (!w) return;
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    body{font-family:Segoe UI,Arial,sans-serif;color:#1f2937;padding:24px;}
    h2{font-size:18px;margin:0 0 4px;} .meta{color:#6b7280;font-size:12px;margin-bottom:16px;}
    table{width:100%;border-collapse:collapse;font-size:12px;}
    th{background:#0d9488;color:#fff;text-align:left;padding:8px 10px;}
    td{padding:7px 10px;border-bottom:1px solid #e5e7eb;}
    tr:nth-child(even) td{background:#f9fafb;}
    @media print{@page{margin:14mm;}}
  </style></head><body><h2>${esc(title)}</h2>
  <div class="meta">Zyter — generated ${esc(new Date().toLocaleString())} · ${rows.length} rows</div>
  <table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>
  <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
  </body></html>`);
  w.document.close();
}
