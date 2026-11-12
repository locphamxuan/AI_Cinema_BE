/** Content of the demo production contract (MF-1). Parties, numbers and addresses are fictional demo data. */
export interface Party {
  name: string;
  address: string;
  taxCode: string;
  phone: string;
  email: string;
  bankAccount: string;
  representative: string;
  title: string;
}

export interface SampleEpisode {
  number: number;
  title: string;
  minutes: number;
  dueDate: string;
}

export interface SampleContract {
  contractNo: string;
  day: string;
  place: string;
  movieTitle: string;
  genre: string;
  ageRating: string;
  episodes: SampleEpisode[];
  costVnd: number;
  costInWords: string;
  partyA: Party;
  partyB: Party;
}

export const money = (amount: number) => `${new Intl.NumberFormat('vi-VN').format(amount)} đồng`;

export const LEGAL_BASES = [
  'Bộ luật Dân sự số 91/2015/QH13 ngày 24/11/2015;',
  'Luật Thương mại số 36/2005/QH11 ngày 14/6/2005;',
  'Luật Sở hữu trí tuệ số 50/2005/QH11, được sửa đổi, bổ sung bởi Luật số 07/2022/QH15;',
  'Luật Điện ảnh số 05/2022/QH15 ngày 15/6/2022;',
  'Luật số 134/2025/QH15 và Nghị định số 142/2026/NĐ-CP về gắn nhãn nội dung do trí tuệ nhân tạo tạo ra;',
  'Kịch bản Final đã được Bên A phê duyệt trên hệ thống AI Cinema và nhu cầu, khả năng của hai bên.',
];

/** Instalments of the production cost: share of the total and when it is due. */
export const PAYMENTS: [number, string][] = [
  [0.3, 'trong 07 ngày làm việc kể từ ngày Hợp đồng có hiệu lực (tạm ứng)'],
  [0.4, 'trong 07 ngày làm việc kể từ ngày Bên A nghiệm thu một nửa số tập theo Phụ lục 01'],
  [0.3, 'trong 15 ngày làm việc kể từ ngày Bên A nghiệm thu tập cuối cùng và hai bên ký biên bản thanh lý'],
];

/** Articles of the contract: heading and its numbered paragraphs. */
export function articles(c: SampleContract): [string, string[]][] {
  const total = money(c.costVnd);
  return [
    [
      'Điều 1. Định nghĩa',
      [
        '1.1. "Phim" là bộ phim "' +
          c.movieTitle +
          '" thể loại ' +
          c.genre +
          ', phân loại ' +
          c.ageRating +
          ', gồm ' +
          c.episodes.length +
          ' tập do Bên B sản xuất theo Hợp đồng này.',
        '1.2. "Kịch bản Final" là phiên bản kịch bản cuối cùng đã được Bên A phê duyệt trên hệ thống AI Cinema trước ngày ký Hợp đồng.',
        '1.3. "Hệ thống AI Cinema" là nền tảng của Bên A, gồm trang quản trị và trang Studio Web mà Bên B dùng để nhận tài liệu, ' +
          'thương lượng, ký hợp đồng và nộp phim.',
        '1.4. "Nghiệm thu" là việc Bên A duyệt nội dung, gắn nhãn AI, kiểm tra tuân thủ và xác nhận Phim Final của từng tập trên Hệ thống AI Cinema.',
      ],
    ],
    [
      'Điều 2. Phạm vi công việc',
      [
        '2.1. Bên B nhận sản xuất toàn bộ Phim đúng Kịch bản Final, đúng thời lượng và hạn giao từng tập nêu tại Phụ lục 01.',
        '2.2. Bên B tự chịu trách nhiệm về nhân lực, thiết bị, phần mềm và công cụ trí tuệ nhân tạo dùng để sản xuất Phim.',
        '2.3. Mỗi tập giao cho Bên A phải đạt tối thiểu độ phân giải 1080p, âm thanh rõ ràng, có phụ đề tiếng Việt và không chứa logo, ' +
          'quảng cáo hoặc nội dung của bên thứ ba.',
        '2.4. Mọi thay đổi về nội dung, số tập hoặc tiến độ chỉ được thực hiện khi có văn bản đồng ý của Bên A.',
      ],
    ],
    [
      'Điều 3. Giá trị Hợp đồng và phương thức thanh toán',
      [
        '3.1. Giá trị Hợp đồng là ' +
          total +
          ' (Bằng chữ: ' +
          c.costInWords +
          '), là chi phí sản xuất trọn gói, đã bao gồm thuế giá trị gia ' +
          'tăng và mọi chi phí để Bên B hoàn thành công việc. Giá trị này là mức hai bên đã thống nhất qua thương lượng trên Hệ thống AI Cinema.',
        '3.2. Bên A thanh toán cho Bên B thành ba đợt:',
        ...PAYMENTS.map(
          ([share, when], i) =>
            `     - Đợt ${i + 1}: ${Math.round(share * 100)}% giá trị Hợp đồng, tương đương ${money(Math.round(c.costVnd * share))}, ${when}.`,
        ),
        '3.3. Thanh toán bằng chuyển khoản vào tài khoản của Bên B nêu tại phần thông tin các bên. Bên B xuất hóa đơn giá trị gia tăng hợp lệ ' +
          'trước mỗi đợt thanh toán.',
        '3.4. Giá trị Hợp đồng không thay đổi trong suốt thời gian thực hiện, trừ khi hai bên ký phụ lục điều chỉnh.',
      ],
    ],
    [
      'Điều 4. Tiến độ và giao nhận',
      [
        '4.1. Bên B nộp từng tập trên Studio Web (tải tệp hoặc đường dẫn lưu trữ) trước hạn giao tại Phụ lục 01.',
        '4.2. Tập nộp sau hạn giao được Hệ thống AI Cinema ghi nhận là trễ hạn và thông báo cho Bên A.',
        '4.3. Bên B được gia hạn khi Bên A chậm cung cấp tài liệu hoặc khi có sự kiện bất khả kháng theo Điều 11.',
      ],
    ],
    [
      'Điều 5. Nghiệm thu',
      [
        '5.1. Trong 05 ngày làm việc kể từ khi nhận tập phim, Bên A duyệt nội dung và thông báo kết quả trên Hệ thống AI Cinema.',
        '5.2. Nếu tập phim chưa đạt yêu cầu, Bên A gửi yêu cầu chỉnh sửa nêu rõ nội dung cần sửa; Bên B sửa và nộp lại trong 05 ngày làm việc. ' +
          'Việc chỉnh sửa theo yêu cầu không làm phát sinh chi phí.',
        '5.3. Tập phim được coi là nghiệm thu khi Bên A xác nhận Phim Final của tập đó trên Hệ thống AI Cinema.',
      ],
    ],
    [
      'Điều 6. Khai báo trí tuệ nhân tạo và tuân thủ pháp luật',
      [
        '6.1. Mỗi tập phim phải kèm bản khai báo AI: công cụ sử dụng, phần hình ảnh, âm thanh, lời thoại do AI tạo ra.',
        '6.2. Bên B cam kết không dùng AI để mô phỏng giọng nói, hình ảnh của người thật khi chưa có sự đồng ý của người đó; không sử dụng ' +
          'tác phẩm có bản quyền của bên thứ ba khi chưa được phép.',
        '6.3. Bên A gắn nhãn nội dung do AI tạo ra trên mọi màn hình phát theo quy định pháp luật; Bên B không được che hoặc xóa nhãn này.',
      ],
    ],
    [
      'Điều 7. Quyền sở hữu trí tuệ',
      [
        '7.1. Kể từ khi tập phim được nghiệm thu và Bên A thanh toán đợt tương ứng, toàn bộ quyền tài sản đối với tập phim thuộc về Bên A, ' +
          'gồm quyền phát sóng, trình chiếu, phân phối trên mọi nền tảng, trong mọi lãnh thổ, không giới hạn thời gian.',
        '7.2. Bên B giữ quyền nhân thân theo quy định của Luật Sở hữu trí tuệ và được ghi tên là đơn vị sản xuất.',
        '7.3. Bên B bảo đảm Phim không xâm phạm quyền của bên thứ ba và chịu trách nhiệm đối với mọi khiếu nại phát sinh từ phần việc của mình.',
      ],
    ],
    [
      'Điều 8. Bảo mật',
      [
        '8.1. Bên B không tiết lộ Kịch bản Final, Phim, tài liệu dự án và thông tin của Hợp đồng cho bất kỳ bên thứ ba nào.',
        '8.2. Nghĩa vụ bảo mật có hiệu lực trong thời gian thực hiện Hợp đồng và 03 năm sau khi Hợp đồng chấm dứt.',
      ],
    ],
    [
      'Điều 9. Quyền và nghĩa vụ của Bên A',
      [
        '9.1. Cung cấp Kịch bản Final, danh sách tập, hạn giao và tài khoản Studio Web cho Bên B.',
        '9.2. Nghiệm thu đúng thời hạn tại Điều 5 và thanh toán đúng hạn tại Điều 3.',
        '9.3. Được yêu cầu chỉnh sửa, từ chối nghiệm thu tập phim chưa đạt yêu cầu và được đổi đơn vị sản xuất khi Bên B vi phạm nghiêm trọng.',
      ],
    ],
    [
      'Điều 10. Quyền và nghĩa vụ của Bên B',
      [
        '10.1. Sản xuất và giao Phim đúng chất lượng, tiến độ đã cam kết.',
        '10.2. Được thanh toán đầy đủ, đúng hạn theo Điều 3; được đề nghị gia hạn khi có căn cứ tại Điều 4.3.',
        '10.3. Phối hợp chỉnh sửa theo yêu cầu nghiệm thu và cung cấp khai báo AI trung thực.',
      ],
    ],
    [
      'Điều 11. Bất khả kháng',
      [
        '11.1. Sự kiện bất khả kháng là sự kiện xảy ra khách quan, không thể lường trước và không thể khắc phục dù đã áp dụng mọi biện pháp ' +
          'cần thiết, theo Điều 156 Bộ luật Dân sự.',
        '11.2. Bên gặp sự kiện bất khả kháng phải thông báo cho bên kia trong 03 ngày làm việc; thời hạn thực hiện được kéo dài tương ứng.',
      ],
    ],
    [
      'Điều 12. Vi phạm Hợp đồng và chấm dứt',
      [
        '12.1. Bên B giao tập trễ hạn quá 07 ngày mà không có lý do chính đáng thì chịu phạt 0,5% giá trị Hợp đồng cho mỗi ngày trễ, ' +
          'tổng mức phạt không quá 8% giá trị phần nghĩa vụ bị vi phạm theo Điều 301 Luật Thương mại.',
        '12.2. Bên A chậm thanh toán thì trả lãi chậm trả theo lãi suất nợ quá hạn trung bình trên thị trường tại thời điểm thanh toán.',
        '12.3. Mỗi bên được đơn phương chấm dứt Hợp đồng khi bên kia vi phạm nghiêm trọng và không khắc phục trong 15 ngày kể từ ngày nhận ' +
          'thông báo. Bên A thanh toán cho phần việc đã được nghiệm thu; phí Studio đã cam kết cho các tập chưa nghiệm thu được giải quyết theo thỏa thuận.',
        '12.4. Khi Bên A hủy dự án phim trước khi có tập nào phát hành, Hợp đồng chấm dứt; Bên A thanh toán cho các tập đã nghiệm thu.',
      ],
    ],
    [
      'Điều 13. Giải quyết tranh chấp',
      [
        '13.1. Tranh chấp phát sinh được giải quyết trước hết bằng thương lượng, hòa giải.',
        '13.2. Nếu không thương lượng được trong 30 ngày, một bên có quyền đưa tranh chấp ra Tòa án nhân dân có thẩm quyền tại ' +
          c.place +
          '.',
      ],
    ],
    [
      'Điều 14. Điều khoản chung',
      [
        '14.1. Hợp đồng có hiệu lực khi có đủ chữ ký của đại diện hai bên. Mỗi bên ký bản Hợp đồng và tải bản PDF đã ký lên Hệ thống AI Cinema; ' +
          'văn bản ghép hai bản có đủ chữ ký do hệ thống tạo có giá trị như bản gốc.',
        '14.2. Phụ lục 01 là bộ phận không tách rời của Hợp đồng. Mọi sửa đổi, bổ sung phải lập thành phụ lục có chữ ký của hai bên.',
        '14.3. Hợp đồng gồm 14 điều và 01 phụ lục, được lập thành 02 bản có giá trị pháp lý như nhau, mỗi bên giữ 01 bản.',
      ],
    ],
  ];
}
