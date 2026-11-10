import PDFDocument from 'pdfkit';
import { pdfText, unicodeFontPath } from '../src/infrastructure/pdf/unicode-font';

/** Who signs a counterpart: only that side's box carries a signature, the other stays empty. */
export type SampleSide = 'ADMIN' | 'STUDIO';

export interface SampleContract {
  contractNo: string;
  day: string;
  movieTitle: string;
  episodes: number;
  costVnd: number;
  costInWords: string;
  studioName: string;
  studioSigner: string;
  adminSigner: string;
}

const money = (amount: number) => `${new Intl.NumberFormat('vi-VN').format(amount)} VND`;

const CLAUSES = (contract: SampleContract): [string, string][] => [
  [
    'Điều 1. Nội dung công việc',
    `Bên B sản xuất bộ phim "${contract.movieTitle}" gồm ${contract.episodes} tập, đúng Kịch bản Final đã được Bên A phê duyệt ` +
      'và đúng hạn giao từng tập công bố trên Studio Web. Mọi thay đổi về nội dung phải được Bên A chấp thuận bằng văn bản.',
  ],
  [
    'Điều 2. Chi phí sản xuất',
    `Chi phí sản xuất trọn gói là ${money(contract.costVnd)} (${contract.costInWords}), đã bao gồm thuế, không chia doanh thu. ` +
      'Mức chi phí này là mức hai bên thống nhất sau quá trình thương lượng trên hệ thống AI Cinema.',
  ],
  [
    'Điều 3. Tiến độ và giao nhận',
    'Bên B nộp phim của từng tập qua Studio Web trước hạn giao. Bên A nghiệm thu qua quy trình duyệt nội dung; ' +
      'nếu có yêu cầu chỉnh sửa, Bên B sửa và nộp lại bản mới trong thời hạn được ghi trong yêu cầu.',
  ],
  [
    'Điều 4. Khai báo AI và tuân thủ pháp luật',
    'Mỗi tập phim phải kèm khai báo AI (công cụ sử dụng, phần nội dung do AI tạo). Bên B cam kết không mô phỏng người thật ' +
      'và không sử dụng tác phẩm có bản quyền của bên thứ ba. Nhãn AI được hiển thị trên mọi màn hình phát theo quy định hiện hành.',
  ],
  [
    'Điều 5. Bản quyền và bảo mật',
    'Toàn bộ quyền tài sản đối với phim thuộc về Bên A kể từ khi nghiệm thu. Bên B không chia sẻ kịch bản, phim hoặc ' +
      'bất kỳ tài liệu nào của dự án cho bên thứ ba khi chưa có sự đồng ý bằng văn bản của Bên A.',
  ],
  [
    'Điều 6. Hiệu lực',
    'Hợp đồng chỉ có hiệu lực khi có đủ chữ ký của cả hai bên. Mỗi bên ký bản hợp đồng này và tải bản PDF đã ký của mình ' +
      'lên hệ thống AI Cinema; hệ thống ghép hai bản thành một văn bản duy nhất mang đủ hai chữ ký.',
  ],
];

/** A drawn placeholder squiggle — obviously a sample, never an imitation of a real signature. */
function drawSignature(doc: PDFKit.PDFDocument, x: number, y: number): void {
  doc
    .save()
    .lineWidth(1.2)
    .moveTo(x, y + 14)
    .bezierCurveTo(x + 18, y - 6, x + 30, y + 26, x + 48, y + 6)
    .bezierCurveTo(x + 62, y - 8, x + 74, y + 20, x + 96, y + 2)
    .stroke()
    .moveTo(x + 6, y + 20)
    .lineTo(x + 86, y + 18)
    .stroke()
    .restore();
}

function signatureBoxes(doc: PDFKit.PDFDocument, contract: SampleContract, side: SampleSide, text: (v: string) => string) {
  const top = doc.y + 16;
  const left = 56;
  const right = 320;
  doc.fontSize(11);
  doc.text(text('ĐẠI DIỆN BÊN A (AI CINEMA)'), left, top, { width: 220 });
  doc.text(text('ĐẠI DIỆN BÊN B (STUDIO)'), right, top, { width: 220 });
  doc.fontSize(9).fillColor('#555555');
  doc.text(text('(Ký, ghi rõ họ tên)'), left, top + 16, { width: 220 });
  doc.text(text('(Ký, ghi rõ họ tên)'), right, top + 16, { width: 220 });
  doc.fillColor('#000000');
  if (side === 'ADMIN') drawSignature(doc, left + 10, top + 42);
  else drawSignature(doc, right + 10, top + 42);
  doc.fontSize(11);
  doc.text(text(contract.adminSigner), left, top + 92, { width: 220 });
  doc.text(text(contract.studioSigner), right, top + 92, { width: 220 });
  doc.fontSize(8).fillColor('#777777');
  doc.text(text('Chữ ký mẫu dùng cho bản demo của đồ án, không phải chữ ký của người thật.'), left, top + 124, {
    width: 460,
  });
  doc.fillColor('#000000');
}

/** One counterpart of the sample contract: the same document, signed by one side only. */
export function renderSampleContract(contract: SampleContract, side: SampleSide): Promise<Buffer> {
  const fontPath = unicodeFontPath(null);
  const text = pdfText(fontPath);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 56,
    info: { Title: `Hop dong san xuat phim - ${contract.contractNo}` },
  });
  if (fontPath) doc.font(fontPath);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(13).text(text('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'), { align: 'center' });
  doc.fontSize(11).text(text('Độc lập - Tự do - Hạnh phúc'), { align: 'center' });
  doc.moveDown().fontSize(17).text(text('HỢP ĐỒNG SẢN XUẤT PHIM'), { align: 'center' });
  doc.fontSize(10).text(text(`Số: ${contract.contractNo} - Ngày ${contract.day}`), { align: 'center' });
  doc.moveDown().fontSize(11);
  doc.text(text('BÊN A (bên đặt hàng): NỀN TẢNG PHÁT HÀNH PHIM AI CINEMA'));
  doc.text(text(`Đại diện: ${contract.adminSigner}`));
  doc.moveDown(0.3);
  doc.text(text(`BÊN B (bên sản xuất): ${contract.studioName.toUpperCase()}`));
  doc.text(text(`Đại diện: ${contract.studioSigner}`));
  doc.moveDown(0.5).fontSize(10);
  doc.text(
    text(
      'Hai bên cùng thống nhất ký kết hợp đồng sản xuất phim với các điều khoản sau, trên cơ sở Kịch bản Final ' +
        'đã được duyệt và mức chi phí sản xuất hai bên đã thương lượng trên hệ thống AI Cinema:',
    ),
    { align: 'justify' },
  );
  for (const [heading, body] of CLAUSES(contract)) {
    doc.moveDown(0.6).fontSize(11).text(text(heading));
    doc.fontSize(10).text(text(body), { align: 'justify' });
  }
  signatureBoxes(doc, contract, side, text);
  doc.end();
  return done;
}
