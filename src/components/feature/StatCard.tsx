import React from 'react';

interface StatCardProps {
  label: string;
  value: number | string;
  sub?: string;
  badge?: React.ReactNode;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, sub, badge }) => (
  <div className="stat-card relative">
    {badge && <div className="absolute top-4 right-4">{badge}</div>}
    <p className="stat-label">{label}</p>
    <p className="stat-value">{value}</p>
    {sub && <p className="stat-sub">{sub}</p>}
  </div>
);
