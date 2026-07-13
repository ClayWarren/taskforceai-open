import {
  Rocket,
  User,
  Globe,
  Monitor,
  Smartphone,
  Terminal,
  Code,
  Code2,
  Building,
  Building2,
  Shield,
  HelpCircle,
  CreditCard,
  Server,
} from 'lucide-react';

export function CategoryIcon({ icon, className }: { icon: string; className?: string }) {
  const props = { className: className || 'h-6 w-6' };

  switch (icon) {
    case 'Rocket':
      return <Rocket {...props} />;
    case 'User':
      return <User {...props} />;
    case 'Globe':
      return <Globe {...props} />;
    case 'Monitor':
      return <Monitor {...props} />;
    case 'Smartphone':
      return <Smartphone {...props} />;
    case 'Terminal':
      return <Terminal {...props} />;
    case 'Code':
    case '{ }':
      return <Code {...props} />;
    case 'Code2':
      return <Code2 {...props} />;
    case 'Building':
      return <Building {...props} />;
    case 'Building2':
      return <Building2 {...props} />;
    case 'Shield':
      return <Shield {...props} />;
    case 'CreditCard':
      return <CreditCard {...props} />;
    case 'Server':
      return <Server {...props} />;
    default:
      return <HelpCircle {...props} />;
  }
}
