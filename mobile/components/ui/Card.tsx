import React from 'react';
import { SurfaceCard, SurfaceCardProps } from './SurfaceCard';

export type CardProps = SurfaceCardProps;

export function Card(props: CardProps) {
  return <SurfaceCard {...props} />;
}
