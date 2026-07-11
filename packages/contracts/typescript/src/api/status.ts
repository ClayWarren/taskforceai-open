export type ServiceStatus = 'operational' | 'degraded' | 'outage' | 'maintenance';

export type DayStatus = {
  date: string;
  status: ServiceStatus;
  message?: string;
};

export type Service = {
  id: string;
  name: string;
  status: ServiceStatus;
  uptimePercent: number;
  uptimeHistory: DayStatus[];
};

export type IncidentUpdate = {
  id: string;
  status: ServiceStatus;
  message: string;
  createdAt: string;
};

export type Incident = {
  id: string;
  title: string;
  status: ServiceStatus;
  affectedServices: string[];
  updates: IncidentUpdate[];
  createdAt: string;
  resolvedAt?: string;
};

export type StatusResponse = {
  overallStatus: ServiceStatus;
  services: Service[];
  incidents?: Incident[];
  lastUpdated: string;
};
