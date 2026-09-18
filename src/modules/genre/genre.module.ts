import { Module } from '@nestjs/common';
import { GenreController } from 'src/modules/genre/genre.controller';
import { GenreService } from 'src/modules/genre/genre.service';

@Module({
  controllers: [GenreController],
  providers: [GenreService],
  exports: [GenreService],
})
export class GenreModule {}
