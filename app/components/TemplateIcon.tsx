import {
  Book,
  BookOpen,
  Briefcase,
  Cake,
  Dices,
  Droplets,
  Heart,
  Package,
  PartyPopper,
  Popcorn,
  School,
  Soup,
  Trophy,
  Utensils,
  Wine,
  type LucideIcon,
} from "lucide-react";
import type { TemplateIcon as TemplateIconKey } from "~/utils/templates";

const ICONS: Record<TemplateIconKey, LucideIcon> = {
  heart: Heart,
  book: Book,
  school: School,
  utensils: Utensils,
  party: PartyPopper,
  cake: Cake,
  popcorn: Popcorn,
  droplets: Droplets,
  package: Package,
  soup: Soup,
  briefcase: Briefcase,
  "book-open": BookOpen,
  trophy: Trophy,
  dice: Dices,
  wine: Wine,
};

export default function TemplateIcon({ icon, className }: { icon: TemplateIconKey; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon className={className} aria-hidden="true" />;
}
