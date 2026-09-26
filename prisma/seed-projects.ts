import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  ProductionContentType,
  ProductionProjectStatus,
  ProductionPlanStatus,
  SceneStatus,
  QuotaAllocationType,
  QuotaAllocationStatus,
  EpisodePackageStatus,
  ReviewStatus,
  ComplianceCheckType,
  ComplianceResult,
  PlanReviewStatus,
  PlanReviewField,
  EpisodeProductionStatus,
} from '@prisma/client';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg(new Pool({ connectionString }));
const prisma = new PrismaClient({ adapter });

async function cleanupProject(title: string) {
  const p = await prisma.productionProject.findFirst({ where: { title } });
  if (!p) return;
  const plans = await prisma.productionPlan.findMany({ where: { productionProjectId: p.id } });
  for (const plan of plans) {
    const pkgs = await prisma.episodePackage.findMany({ where: { productionPlanId: plan.id } });
    for (const pkg of pkgs) {
      await prisma.publication.deleteMany({ where: { episodePackageId: pkg.id } });
      await prisma.complianceCheck.deleteMany({ where: { episodePackageId: pkg.id } });
      await prisma.review.deleteMany({ where: { episodePackageId: pkg.id } });
      await prisma.aiContentLabel.deleteMany({ where: { episodePackageId: pkg.id } });
      await prisma.episodePackageSubtitle.deleteMany({ where: { episodePackageId: pkg.id } });
      await prisma.episode.deleteMany({ where: { currentPackageId: pkg.id } });
      await prisma.episodePackage.delete({ where: { id: pkg.id } });
    }
    await prisma.generationJob.deleteMany({ where: { productionPlanId: plan.id } });
    await prisma.planReview.deleteMany({ where: { productionPlanId: plan.id } });
    await prisma.scene.deleteMany({ where: { productionPlanId: plan.id } });
    await prisma.quotaAllocation.deleteMany({ where: { productionPlanId: plan.id } });
    await prisma.productionPlan.delete({ where: { id: plan.id } });
  }
  await prisma.quotaAllocation.deleteMany({ where: { productionProjectId: p.id } });
  await prisma.milestone.deleteMany({ where: { productionProjectId: p.id } });
  await prisma.productionProjectGenre.deleteMany({ where: { productionProjectId: p.id } });
  await prisma.projectPolicy.deleteMany({ where: { productionProjectId: p.id } });
  if (p.movieId) {
    await prisma.episode.deleteMany({ where: { movieId: p.movieId } });
    await prisma.productionProject.update({ where: { id: p.id }, data: { movieId: null } });
    await prisma.movie.delete({ where: { id: p.movieId } });
  }
  await prisma.productionProject.delete({ where: { id: p.id } });
}

async function seedForCreator(creatorEmail: string) {
  const creator = await prisma.user.findUnique({ where: { email: creatorEmail } });
  if (!creator) {
    console.log(`Creator ${creatorEmail} not found, skipping.`);
    return;
  }

  const reviewer = (await prisma.user.findFirst({ where: { role: 'CONTENT_REVIEWER' } })) ?? creator;
  const policy = await prisma.policy.findFirst();
  const sciFi = await prisma.genre.findFirst({ where: { name: 'Khoa học viễn tưởng' } });
  const thriller = await prisma.genre.findFirst({ where: { name: 'Giật gân' } });
  const action = await prisma.genre.findFirst({ where: { name: 'Hành động' } });
  const adventure = await prisma.genre.findFirst({ where: { name: 'Phiêu lưu' } });
  const historical = await prisma.genre.findFirst({ where: { name: 'Cổ trang' } });
  const fantasy = await prisma.genre.findFirst({ where: { name: 'Giả tưởng' } });
  const aiModel = await prisma.aiModel.findFirst();

  console.log(`Seeding projects for creator ${creator.email} (${creator.id})...`);

  // PROJECT 1: "Sài Gòn 2077: Bản Giao Hưởng Ánh Sáng" (ACTIVE - In production)
  const p1Title = creatorEmail === 'creatorr@gmail.com' 
    ? 'Sài Gòn 2077: Bản Giao Hưởng Ánh Sáng' 
    : `Sài Gòn 2077: Bản Giao Hưởng Ánh Sáng (${creatorEmail.split('@')[0]})`;

  await cleanupProject(p1Title);
  let project1 = await prisma.productionProject.findFirst({ where: { title: p1Title } });
  if (!project1) {
    project1 = await prisma.productionProject.create({
      data: {
        title: p1Title,
        description: 'Vào năm 2077, Sài Gòn trở thành một siêu đô thị ngập tràn ánh đèn neon và công nghệ trí tuệ nhân tạo. Một thám tử mạng điều tra chuỗi sự cố bí ẩn liên quan đến các android thế hệ mới.',
        contentType: ProductionContentType.SERIES,
        createdById: reviewer.id,
        assignedCreatorId: creator.id,
        episodeCount: 3,
        productionStartDate: new Date(Date.now() - 7 * 86400000),
        deadline: new Date(Date.now() + 30 * 86400000),
        plannedReleaseDate: new Date(Date.now() + 45 * 86400000),
        defaultEpisodeDurationSeconds: 1200,
        totalAiQuotaBudget: 3000,
        remainingAiQuotaBudget: 2200,
        status: ProductionProjectStatus.ACTIVE,
        primaryGenreId: sciFi?.id,
        subtitleLanguages: ['vi', 'en'],
      },
    });

    if (sciFi) await prisma.productionProjectGenre.create({ data: { productionProjectId: project1.id, genreId: sciFi.id } });
    if (thriller) await prisma.productionProjectGenre.create({ data: { productionProjectId: project1.id, genreId: thriller.id } });
    if (policy) await prisma.projectPolicy.create({ data: { productionProjectId: project1.id, policyId: policy.id } });

    await prisma.milestone.createMany({
      data: [
        {
          productionProjectId: project1.id,
          title: 'Cột mốc 1: Kịch bản và phân rã các tập',
          description: 'Hoàn thiện kịch bản chi tiết 3 tập đầu và danh sách phân cảnh.',
          startDate: new Date(Date.now() - 7 * 86400000),
          targetDate: new Date(Date.now() - 2 * 86400000),
          status: 'COMPLETED',
        },
        {
          productionProjectId: project1.id,
          title: 'Cột mốc 2: Sản xuất video AI tập 1',
          description: 'Sinh các cảnh video chính, audio lồng tiếng và hiệu ứng ánh sáng.',
          startDate: new Date(Date.now() - 2 * 86400000),
          targetDate: new Date(Date.now() + 10 * 86400000),
          status: 'IN_PROGRESS',
        },
        {
          productionProjectId: project1.id,
          title: 'Cột mốc 3: Dựng hậu kỳ & kiểm định nhãn AI',
          description: 'Hậu kỳ bản dựng, kiểm duyệt pháp lý Điều 44 và phát hành.',
          startDate: new Date(Date.now() + 11 * 86400000),
          targetDate: new Date(Date.now() + 25 * 86400000),
          status: 'PLANNED',
        },
      ],
    });

    // Episode 1 Plan: APPROVED & IN_PRODUCTION (Quota 800 tokens, 4 scenes)
    const plan1 = await prisma.productionPlan.create({
      data: {
        productionProjectId: project1.id,
        episodeNumber: 1,
        seasonNumber: 1,
        seasonEpisodeNumber: 1,
        allottedDurationSeconds: 1200,
        planVersion: 1,
        scriptText: 'Cơn mưa axit trút xuống những tòa nhà chọc trời của quận Ánh Sáng. Lâm - thám tử tư cyborg - bước vào con ngõ tối dẫn tới câu lạc bộ CyberNet.',
        productionApproach: 'Phong cách Cyberpunk neon u tối, tông màu tím - xanh cyan, camera tracking chuyển động mượt mà.',
        targetDurationSeconds: 1200,
        targetLanguages: ['vi', 'en'],
        estimatedAiResourceUsage: 800,
        status: ProductionPlanStatus.APPROVED,
        totalSceneCount: 4,
        completedSceneCount: 2,
        createdById: creator.id,
      },
    });

    const alloc1 = await prisma.quotaAllocation.create({
      data: {
        productionProjectId: project1.id,
        productionPlanId: plan1.id,
        allocationType: QuotaAllocationType.INITIAL,
        allocatedAmount: 800,
        remainingAmount: 550,
        status: QuotaAllocationStatus.ACTIVE,
        allocatedById: reviewer.id,
      },
    });

    const sc1 = await prisma.scene.create({
      data: {
        productionPlanId: plan1.id,
        sceneNumber: 1,
        title: 'Cơn mưa trên phố Cyberpunk',
        description: 'Toàn cảnh flycam từ trên cao nhìn xuống đường phố ngập đèn neon phản chiếu dưới mặt đường ướt mưa.',
        targetDurationSeconds: 30,
        estimatedTokens: 150,
        status: SceneStatus.COMPLETED,
      },
    });
    const sc2 = await prisma.scene.create({
      data: {
        productionPlanId: plan1.id,
        sceneNumber: 2,
        title: 'Cuộc gặp tại quán bar Neon',
        description: 'Lâm tiếp cận người chỉ điểm bí ẩn ngồi ở góc tối quầy bar, ánh sáng tím nhấp nháy.',
        targetDurationSeconds: 45,
        estimatedTokens: 200,
        status: SceneStatus.COMPLETED,
      },
    });
    await prisma.scene.create({
      data: {
        productionPlanId: plan1.id,
        sceneNumber: 3,
        title: 'Rượt đuổi qua đường tàu điện trên cao',
        description: 'Kẻ lạ mặt bỏ chạy, Lâm đuổi theo qua các toa tàu điện lơ lửng giữa không trung.',
        targetDurationSeconds: 45,
        estimatedTokens: 250,
        status: SceneStatus.GENERATING,
      },
    });
    await prisma.scene.create({
      data: {
        productionPlanId: plan1.id,
        sceneNumber: 4,
        title: 'Đối đầu trong nhà kho bỏ hoang',
        description: 'Trận đọ súng kịch tính trong kho hàng bến cảng, khói và tia lửa điện bắn tung tóe.',
        targetDurationSeconds: 60,
        estimatedTokens: 200,
        status: SceneStatus.APPROVED,
      },
    });

    if (aiModel) {
      await prisma.generationJob.create({
        data: {
          productionPlan: { connect: { id: plan1.id } },
          scene: { connect: { id: sc1.id } },
          aiModel: { connect: { id: aiModel.id } },
          jobType: 'SCENE_VIDEO',
          rawPrompt: 'Cyberpunk rainy street neon lights cinematic 4k drone flythrough',
          attemptNumber: 1,
          status: 'COMPLETED',
          createdBy: { connect: { id: creator.id } },
          quotaAllocation: { connect: { id: alloc1.id } },
        },
      });
      await prisma.generationJob.create({
        data: {
          productionPlan: { connect: { id: plan1.id } },
          scene: { connect: { id: sc2.id } },
          aiModel: { connect: { id: aiModel.id } },
          jobType: 'SCENE_VIDEO',
          rawPrompt: 'Cyberpunk bar interior neon purple dim lighting conversation',
          attemptNumber: 1,
          status: 'COMPLETED',
          createdBy: { connect: { id: creator.id } },
          quotaAllocation: { connect: { id: alloc1.id } },
        },
      });
    }

    // Episode 2 Plan: SUBMITTED (Pending review)
    const plan2 = await prisma.productionPlan.create({
      data: {
        productionProjectId: project1.id,
        episodeNumber: 2,
        seasonNumber: 1,
        seasonEpisodeNumber: 2,
        allottedDurationSeconds: 1200,
        planVersion: 1,
        scriptText: 'Dấu vết từ câu lạc bộ dẫn Lâm đến tháp CyberCore. Tại đây anh phát hiện ra hồ sơ về dự án Promethius.',
        productionApproach: 'Phong cách công nghệ cao bí ẩn, góc máy thấp thể hiện sự áp đảo của tập đoàn.',
        targetDurationSeconds: 1200,
        targetLanguages: ['vi', 'en'],
        estimatedAiResourceUsage: 750,
        status: ProductionPlanStatus.SUBMITTED,
        totalSceneCount: 3,
        completedSceneCount: 0,
        createdById: creator.id,
      },
    });
    await prisma.scene.createMany({
      data: [
        {
          productionPlanId: plan2.id,
          sceneNumber: 1,
          title: 'Đột nhập tháp CyberCore',
          description: 'Lâm vô hiệu hóa hệ thống camera và lẻn vào sảnh chính vắng lặng.',
          targetDurationSeconds: 40,
          estimatedTokens: 200,
          status: SceneStatus.SUBMITTED,
        },
        {
          productionPlanId: plan2.id,
          sceneNumber: 2,
          title: 'Giải mã máy chủ trung tâm',
          description: 'Màn hình dữ liệu 3D hiện lên dồn dập các sơ đồ mạch não nhân tạo.',
          targetDurationSeconds: 35,
          estimatedTokens: 180,
          status: SceneStatus.SUBMITTED,
        },
        {
          productionPlanId: plan2.id,
          sceneNumber: 3,
          title: 'Báo động đỏ và tháo chạy',
          description: 'Còi báo động hú vang, cửa thép khóa sập, đội phản ứng nhanh xuất hiện.',
          targetDurationSeconds: 45,
          estimatedTokens: 220,
          status: SceneStatus.SUBMITTED,
        },
      ],
    });

    // Episode 3 Plan: DRAFT
    await prisma.productionPlan.create({
      data: {
        productionProjectId: project1.id,
        episodeNumber: 3,
        seasonNumber: 1,
        seasonEpisodeNumber: 3,
        allottedDurationSeconds: 1200,
        planVersion: 1,
        scriptText: 'Kịch bản đang biên soạn: Đỉnh tháp Saigon Sky và sự thật chấn động về nhân cách của Lâm...',
        targetDurationSeconds: 1200,
        targetLanguages: ['vi', 'en'],
        status: ProductionPlanStatus.DRAFT,
        createdById: creator.id,
      },
    });

    console.log(`✓ Project 1 created: ${p1Title}`);
  }

  // PROJECT 2: "Huyền Thoại Đại Ngàn" (ACTIVE - In production with Changes Requested)
  const p2Title = creatorEmail === 'creatorr@gmail.com'
    ? 'Huyền Thoại Đại Ngàn: Viên Đá Ngũ Sắc'
    : `Huyền Thoại Đại Ngàn: Viên Đá Ngũ Sắc (${creatorEmail.split('@')[0]})`;

  await cleanupProject(p2Title);
  let project2 = await prisma.productionProject.findFirst({ where: { title: p2Title } });
  if (!project2) {
    project2 = await prisma.productionProject.create({
      data: {
        title: p2Title,
        description: 'Hành trình của người chiến binh trẻ vượt qua các vùng đất huyền bí ở Tây Nguyên cổ xưa để bảo vệ viên đá ngũ sắc khỏi thế lực bóng tối.',
        contentType: ProductionContentType.SERIES,
        createdById: reviewer.id,
        assignedCreatorId: creator.id,
        episodeCount: 2,
        productionStartDate: new Date(Date.now() - 3 * 86400000),
        deadline: new Date(Date.now() + 20 * 86400000),
        plannedReleaseDate: new Date(Date.now() + 35 * 86400000),
        defaultEpisodeDurationSeconds: 900,
        totalAiQuotaBudget: 2000,
        remainingAiQuotaBudget: 2000,
        status: ProductionProjectStatus.ACTIVE,
        primaryGenreId: historical?.id,
        subtitleLanguages: ['vi'],
      },
    });

    if (historical) await prisma.productionProjectGenre.create({ data: { productionProjectId: project2.id, genreId: historical.id } });
    if (fantasy) await prisma.productionProjectGenre.create({ data: { productionProjectId: project2.id, genreId: fantasy.id } });
    if (policy) await prisma.projectPolicy.create({ data: { productionProjectId: project2.id, policyId: policy.id } });

    await prisma.milestone.createMany({
      data: [
        {
          productionProjectId: project2.id,
          title: 'Cột mốc 1: Thiết kế tạo hình & bối cảnh rừng đại ngàn',
          description: 'Trang phục cổ trang, vũ khí và sinh vật thần thoại.',
          startDate: new Date(Date.now() - 3 * 86400000),
          targetDate: new Date(Date.now() + 5 * 86400000),
          status: 'IN_PROGRESS',
        },
      ],
    });

    const p2plan1 = await prisma.productionPlan.create({
      data: {
        productionProjectId: project2.id,
        episodeNumber: 1,
        seasonNumber: 1,
        seasonEpisodeNumber: 1,
        allottedDurationSeconds: 900,
        planVersion: 1,
        scriptText: 'Tiếng cồng chiêng ngân vang báo hiệu điềm gở. Y-Bling nhìn lên ngọn núi lửa đang bốc khói đen...',
        targetDurationSeconds: 900,
        targetLanguages: ['vi'],
        estimatedAiResourceUsage: 600,
        status: ProductionPlanStatus.CHANGES_REQUESTED,
        createdById: creator.id,
      },
    });

    await prisma.planReview.create({
      data: {
        productionPlanId: p2plan1.id,
        reviewerId: reviewer.id,
        field: PlanReviewField.OVERALL_SCRIPT,
        status: PlanReviewStatus.CHANGES_REQUESTED,
        rejectionReason: 'Cần làm rõ động cơ của Y-Bling khi nhận nhiệm vụ lên núi lửa và bổ sung miêu tả chi tiết trang phục cổ trang.',
      },
    });

    await prisma.productionPlan.create({
      data: {
        productionProjectId: project2.id,
        episodeNumber: 2,
        seasonNumber: 1,
        seasonEpisodeNumber: 2,
        allottedDurationSeconds: 900,
        planVersion: 1,
        status: ProductionPlanStatus.DRAFT,
        createdById: creator.id,
      },
    });

    console.log(`✓ Project 2 created: ${p2Title}`);
  }

  // PROJECT 3: "Mật Mã Thời Gian: Hồi Kết" (COMPLETED - Phim đã hoàn thành)
  const p3Title = creatorEmail === 'creatorr@gmail.com'
    ? 'Mật Mã Thời Gian: Hồi Kết'
    : `Mật Mã Thời Gian: Hồi Kết (${creatorEmail.split('@')[0]})`;

  await cleanupProject(p3Title);
  let project3 = await prisma.productionProject.findFirst({ where: { title: p3Title } });
  if (!project3) {
    const movie = await prisma.movie.create({
      data: {
        title: p3Title,
        synopsis: 'Cuộc chạy đua sinh tử với thời gian của nhóm mật vụ nhằm ngăn chặn thảm họa nghịch lý vũ trụ.',
        defaultLanguage: 'vi',
        description: 'Tác phẩm điện ảnh ngắn hoàn toàn sản xuất bằng công nghệ AI đạt chuẩn kiểm định pháp lý.',
        posterUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop',
        bannerUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200&auto=format&fit=crop',
        releaseYear: 2026,
        ageRating: 'T16',
        createdById: creator.id,
      },
    });

    project3 = await prisma.productionProject.create({
      data: {
        title: p3Title,
        description: 'Tác phẩm điện ảnh ngắn hoàn thành toàn bộ các giai đoạn sản xuất, kiểm định và phát hành.',
        contentType: ProductionContentType.MOVIE,
        createdById: reviewer.id,
        assignedCreatorId: creator.id,
        episodeCount: 1,
        productionStartDate: new Date(Date.now() - 30 * 86400000),
        deadline: new Date(Date.now() - 10 * 86400000),
        plannedReleaseDate: new Date(Date.now() - 5 * 86400000),
        defaultEpisodeDurationSeconds: 1500,
        totalAiQuotaBudget: 1500,
        remainingAiQuotaBudget: 0,
        status: ProductionProjectStatus.COMPLETED,
        primaryGenreId: action?.id,
        movieId: movie.id,
        subtitleLanguages: ['vi', 'en'],
      },
    });

    if (action) await prisma.productionProjectGenre.create({ data: { productionProjectId: project3.id, genreId: action.id } });
    if (adventure) await prisma.productionProjectGenre.create({ data: { productionProjectId: project3.id, genreId: adventure.id } });
    if (policy) await prisma.projectPolicy.create({ data: { productionProjectId: project3.id, policyId: policy.id } });

    await prisma.milestone.createMany({
      data: [
        {
          productionProjectId: project3.id,
          title: 'Cột mốc 1: Hoàn thiện kịch bản điện ảnh',
          startDate: new Date(Date.now() - 30 * 86400000),
          targetDate: new Date(Date.now() - 22 * 86400000),
          status: 'COMPLETED',
        },
        {
          productionProjectId: project3.id,
          title: 'Cột mốc 2: Sản xuất toàn bộ cảnh quay AI',
          startDate: new Date(Date.now() - 22 * 86400000),
          targetDate: new Date(Date.now() - 12 * 86400000),
          status: 'COMPLETED',
        },
        {
          productionProjectId: project3.id,
          title: 'Cột mốc 3: Kiểm định pháp lý & phát hành toàn cầu',
          startDate: new Date(Date.now() - 12 * 86400000),
          targetDate: new Date(Date.now() - 5 * 86400000),
          status: 'COMPLETED',
        },
      ],
    });

    const p3plan = await prisma.productionPlan.create({
      data: {
        productionProjectId: project3.id,
        episodeNumber: 1,
        seasonNumber: 1,
        seasonEpisodeNumber: 1,
        allottedDurationSeconds: 1500,
        planVersion: 1,
        scriptText: 'Đồng hồ đếm ngược dừng lại ở 00:00:01. Nghịch lý thời gian đã được hàn gắn...',
        targetDurationSeconds: 1500,
        targetLanguages: ['vi', 'en'],
        estimatedAiResourceUsage: 1500,
        status: ProductionPlanStatus.APPROVED,
        totalSceneCount: 3,
        completedSceneCount: 3,
        createdById: creator.id,
      },
    });

    await prisma.quotaAllocation.create({
      data: {
        productionProjectId: project3.id,
        productionPlanId: p3plan.id,
        allocationType: QuotaAllocationType.INITIAL,
        allocatedAmount: 1500,
        remainingAmount: 0,
        status: QuotaAllocationStatus.CONSUMED,
        allocatedById: reviewer.id,
      },
    });

    const pkg3 = await prisma.episodePackage.create({
      data: {
        productionPlanId: p3plan.id,
        packageVersion: 1,
        status: EpisodePackageStatus.ASSEMBLED,
        durationSeconds: 1520,
        streamUrl: 'https://pub-a25bed12bf0f4514910fbf5cba32666f.r2.dev/sample-movie.m3u8',
        qualities: ['1080p', '720p', '480p'],
        assembledBy: creator.id,
      },
    });

    await prisma.episodePackageSubtitle.createMany({
      data: [
        {
          episodePackageId: pkg3.id,
          language: 'vi',
          content: 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\n[Nhạc kịch tính nổi lên]',
        },
        {
          episodePackageId: pkg3.id,
          language: 'en',
          content: 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\n[Dramatic music swells]',
        },
      ],
    });

    const checkTypes: ComplianceCheckType[] = [
      'CONTENT_POLICY',
      'LEGAL',
      'COPYRIGHT',
      'WATERMARK',
      'REAL_PERSON_LIKENESS',
      'AI_LABEL_PRESENCE',
    ];
    await prisma.complianceCheck.createMany({
      data: checkTypes.map((type) => ({
        episodePackageId: pkg3.id,
        checkType: type,
        result: ComplianceResult.PASS,
        checkedById: reviewer.id,
        policyId: policy.id,
      })),
    });

    await prisma.review.create({
      data: {
        episodePackageId: pkg3.id,
        reviewerId: reviewer.id,
        status: ReviewStatus.APPROVED,
        comments: 'Bản dựng xuất sắc, âm thanh hòa trộn tốt, tuân thủ đầy đủ Điều 44 Luật 134/2025/QH15.',
      },
    });

    await prisma.aiContentLabel.create({
      data: {
        episodePackageId: pkg3.id,
        labelType: 'AI_GENERATED',
        labelText: 'Phim có chứa nội dung do trí tuệ nhân tạo (AI) tạo ra theo Điều 44 Luật số 134/2025/QH15',
        displayLocation: 'INTRO_OUTRO',
        appliedById: reviewer.id,
        policyId: policy.id,
      },
    });

    const ep = await prisma.episode.create({
      data: {
        movieId: movie.id,
        episodeNumber: 1,
        title: 'Tập 1: Bản Điện Ảnh',
        thumbnailUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop',
        durationSeconds: 1520,
        productionStatus: EpisodeProductionStatus.PUBLISHED,
        currentPackageId: pkg3.id,
      },
    });

    await prisma.publication.create({
      data: {
        episodeId: ep.id,
        episodePackageId: pkg3.id,
        publishedById: reviewer.id,
        publishedAt: new Date(Date.now() - 5 * 86400000),
      },
    });

    console.log(`✓ Project 3 created: ${p3Title}`);
  }
}

async function main() {
  await seedForCreator('creatorr@gmail.com');
  await seedForCreator('creator01@aicinema.com');
  console.log('Finished seeding real database production projects!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
