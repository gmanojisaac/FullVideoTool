import React from 'react';
import { Composition, staticFile } from 'remotion';
import { Lesson } from './Lesson';
import { LessonData, fps, height, totalFrames, width } from './theme';

const empty: LessonData = { title: '', grid: 'full_grid.png', gridWidth: 1920, gridHeight: 1080, cells: [], tiles: [] };
/** One composition, both formats: `data.json` decides the aspect ratio (mobile 1080×1920, desktop 1920×1080). */
export const Root: React.FC = () => (
  <Composition id="Lesson" component={Lesson} durationInFrames={186} fps={fps} width={width} height={height} defaultProps={{ data: empty }}
    calculateMetadata={async () => {
      const data: LessonData = await fetch(staticFile('data.json')).then(r => r.json()), mobile = data.format === 'mobile';
      return { durationInFrames: totalFrames(data), width: mobile ? 1080 : 1920, height: mobile ? 1920 : 1080, props: { data } };
    }} />
);
