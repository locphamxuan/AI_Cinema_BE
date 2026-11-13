import { ChunkingService } from './chunking.service';

const chunking = new ChunkingService();

describe('ChunkingService — headings', () => {
  it('tracks the heading path and resets deeper levels on a new higher-level heading', () => {
    const chunks = chunking.chunk(
      [
        'Dòng dẫn trước các heading.',
        '',
        '# Gói dịch vụ',
        'Các gói đang bán.',
        '',
        '## Gói Tháng',
        'Quyền lợi gói tháng.',
        '',
        '## Gói Năm',
        'Quyền lợi gói năm.',
        '',
        '# Thanh toán',
        'Các kênh thanh toán.',
      ].join('\n'),
    );

    expect(chunks.map((chunk) => chunk.heading)).toEqual([
      '',
      'Gói dịch vụ',
      'Gói dịch vụ > Gói Tháng',
      'Gói dịch vụ > Gói Năm',
      'Thanh toán',
    ]);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('prefixes every chunk with the root heading', () => {
    const chunks = chunking.chunk(['# Gói Tháng', 'Quyền lợi.'].join('\n'), 'Hướng dẫn Coin');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading).toBe('Hướng dẫn Coin > Gói Tháng');
    expect(chunks[0].content).toBe('Hướng dẫn Coin > Gói Tháng\n\nQuyền lợi.');
  });

  it('strips closed-ATX markers but ignores # inside fenced code blocks', () => {
    const chunks = chunking.chunk(
      ['## Gói Tháng ##', 'Quyền lợi.', '', '```', '# Đây không phải heading', '```', '', 'Vẫn thuộc Gói Tháng.'].join(
        '\n',
      ),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading).toBe('Gói Tháng');
    expect(chunks[0].content).toContain('# Đây không phải heading');
    expect(chunks[0].content).toContain('Vẫn thuộc Gói Tháng.');
  });

  it('handles Windows line endings', () => {
    const chunks = chunking.chunk('# Gói Tháng\r\nQuyền lợi.\r\n## Số dư\r\nSố dư là 100.');

    expect(chunks.map((chunk) => chunk.heading)).toEqual(['Gói Tháng', 'Gói Tháng > Số dư']);
  });
});

describe('ChunkingService — empty content', () => {
  it('returns nothing for empty or whitespace-only markdown', () => {
    expect(chunking.chunk('')).toEqual([]);
    expect(chunking.chunk('   \n\n\t\n')).toEqual([]);
  });

  it('returns nothing for headings with no body', () => {
    expect(chunking.chunk('# Chỉ heading\n## Không có nội dung\n')).toEqual([]);
  });

  it('keeps the root heading out of empty sections', () => {
    expect(chunking.chunk('', 'Hướng dẫn')).toEqual([]);
  });
});

describe('ChunkingService — long sections and overlap', () => {
  it('keeps short sections whole (up to 1200 characters) with heading-aware content', () => {
    const body = 'Số dư Coin của bạn là 100.';
    const chunks = chunking.chunk(['# Số dư', body].join('\n'));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(`Số dư\n\n${body}`);
    expect(chunks[0].tokenCount).toBe(Math.ceil(body.length / 4));
  });

  it('splits a 2500-character section into overlapping windows of at most 1000 characters', () => {
    const body = 'x'.repeat(2500);
    const chunks = chunking.chunk(['# Dài', body].join('\n'));

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((chunk) => chunk.content.length <= 1000 + 'Dài\n\n'.length)).toBe(true);
    const pieces = chunks.map((chunk) => chunk.content.replace(/^Dài\n\n/, ''));
    for (let index = 0; index + 1 < pieces.length; index++) {
      // 180-character overlap: the next piece starts where the previous one left 180 characters.
      expect(pieces[index + 1].slice(0, 180)).toBe(pieces[index].slice(-180));
    }
  });

  it('cuts near sentence boundaries instead of mid-word when separators exist', () => {
    const firstSentence = `Đây là câu thứ nhất về ví Coin của thành viên.`;
    const secondSentence = `Số dư được hiển thị ngay trên màn hình ví.`;
    const thirdSentence = `Khi nạp tiền, Coin sẽ vào ví sau vài phút.`;
    const body = [firstSentence, secondSentence, thirdSentence]
      .map((sentence) => `${sentence} `.repeat(12))
      .join('')
      .trim();
    const chunks = chunking.chunk(body);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 1000)).toBe(true);
    expect(chunks[0].content.endsWith('.')).toBe(true);
  });

  it('caps the output at 200 chunks', () => {
    const markdown = Array.from({ length: 210 }, (_, index) => `# Mục ${index}\nNội dung ${index}`).join('\n');

    const chunks = chunking.chunk(markdown);

    expect(chunks).toHaveLength(200);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks.at(-1)?.chunkIndex).toBe(199);
    expect(chunks.at(-1)?.heading).toBe('Mục 199');
  });
});

describe('ChunkingService — Vietnamese text', () => {
  it('preserves diacritics end to end', () => {
    const chunks = chunking.chunk(
      ['# Số dư Coin', 'Số dư Coin chính và Coin thưởng của thành viên được hiển thị trong ví.'].join('\n'),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('Số dư Coin chính và Coin thưởng của thành viên được hiển thị trong ví.');
    expect(chunks[0].heading).toBe('Số dư Coin');
  });

  it('counts roughly four characters per token for Vietnamese', () => {
    const body = 'Số dư: '.repeat(10); // 70 characters → 18 tokens
    const chunks = chunking.chunk(body);

    expect(chunks[0].tokenCount).toBe(18);
  });
});
