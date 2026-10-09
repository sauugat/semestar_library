import React from 'react';
import { TabSwipeContainer } from '@/components/navigation/TabSwipeContainer';
import { GamesView } from '@/components/games/GamesView';

export default function GamesScreen() {
  return (
    <TabSwipeContainer tabIndex={3}>
      <GamesView />
    </TabSwipeContainer>
  );
}
