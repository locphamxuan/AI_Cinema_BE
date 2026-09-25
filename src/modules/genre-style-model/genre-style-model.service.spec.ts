import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { GenreStyleModelStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { genreStyleDatasetFolder, slugify } from './genre-style-dataset';
import { GenreStyleModelService } from './genre-style-model.service';
import { MockLoraTrainingProvider } from './lora-training-provider';

const DATASET_FOLDER = 'genre-styles/kinh-di/aicinema-horror-style/v1';

describe('genre style dataset folders', () => {
  it('slugifies Vietnamese genre names', () => {
    expect(slugify('Khoa học viễn tưởng')).toBe('khoa-hoc-vien-tuong');
    expect(slugify('Hành động')).toBe('hanh-dong');
    expect(slugify('Miền Tây')).toBe('mien-tay');
  });

  it('builds one folder per genre, trigger keyword and version', () => {
    expect(genreStyleDatasetFolder('Kinh dị', 'aicinema-horror-style', 1)).toBe(DATASET_FOLDER);
  });
});

describe('GenreStyleModelService dataset', () => {
  let root: string;
  const styleModel = {
    id: 'style-id',
    triggerKeyword: 'aicinema-horror-style',
    version: 1,
    status: GenreStyleModelStatus.DRAFT,
    minSampleThreshold: 2,
    genre: { name: 'Kinh dị' },
    trainingSamples: [{ storageKey: `${DATASET_FOLDER}/001.png` }],
  };
  const tx = {
    genreStyleTrainingSample: { create: jest.fn(), createMany: jest.fn(), count: jest.fn() },
    genreStyleModel: { update: jest.fn() },
  };
  const prisma = {
    genreStyleModel: { findUnique: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new GenreStyleModelService(prisma as unknown as PrismaService, new MockLoraTrainingProvider());

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.genreStyleModel.findUnique.mockResolvedValue(styleModel);
    root = await mkdtemp(path.join(tmpdir(), 'training-data-'));
    process.env.TRAINING_DATA_ROOT = root;
  });

  afterEach(async () => {
    delete process.env.TRAINING_DATA_ROOT;
    await rm(root, { recursive: true, force: true });
  });

  it('exposes the dataset folder on the style model', async () => {
    await expect(service.findById('style-id')).resolves.toMatchObject({ datasetFolder: DATASET_FOLDER });
  });

  it('rejects a sample outside the style dataset folder', async () => {
    await expect(
      service.addTrainingSample('style-id', { storageKey: 'genre-styles/hanh-dong/aicinema-action-style/v1/002.png' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('imports new images with their sibling captions and skips known ones', async () => {
    const folder = path.join(root, DATASET_FOLDER);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, '001.png'), '');
    await writeFile(path.join(folder, '002.jpg'), '');
    await writeFile(path.join(folder, '002.txt'), 'foggy corridor, cold blue light\n');
    await writeFile(path.join(folder, '003.webp'), '');
    await writeFile(path.join(folder, '.gitkeep'), '');
    tx.genreStyleTrainingSample.count.mockResolvedValue(3);
    tx.genreStyleModel.update.mockResolvedValue({ sampleCount: 3, status: GenreStyleModelStatus.DATASET_READY });

    const result = await service.importDatasetFolder('style-id');

    expect(tx.genreStyleTrainingSample.createMany).toHaveBeenCalledWith({
      data: [
        {
          genreStyleModelId: 'style-id',
          storageKey: `${DATASET_FOLDER}/002.jpg`,
          caption: 'foggy corridor, cold blue light',
        },
        { genreStyleModelId: 'style-id', storageKey: `${DATASET_FOLDER}/003.webp`, caption: null },
      ],
    });
    expect(tx.genreStyleModel.update).toHaveBeenCalledWith({
      where: { id: 'style-id' },
      data: { sampleCount: 3, status: GenreStyleModelStatus.DATASET_READY },
    });
    expect(result).toEqual({ imported: 2, sampleCount: 3, status: GenreStyleModelStatus.DATASET_READY });
  });

  it('refuses to change the dataset once training started', async () => {
    prisma.genreStyleModel.findUnique.mockResolvedValue({ ...styleModel, status: GenreStyleModelStatus.TRAINING });

    await expect(service.importDatasetFolder('style-id')).rejects.toThrow(ConflictException);
  });
});
