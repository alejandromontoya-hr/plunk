import {useActiveProject} from '../lib/contexts/ActiveProjectProvider';
import {useUser} from '../lib/hooks/useUser';
import {WIKI_URI} from '../lib/constants';
import {network} from '../lib/network';
import {UI_LANGUAGES, useTranslation} from '../lib/i18n';
import {OnboardingBanner} from './onboarding/OnboardingBanner';
import {
  Activity,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  Globe,
  Layers,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Plus,
  Settings,
  Users,
  Workflow
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import {useRouter} from 'next/router';
import {useCallback, useMemo, useState} from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@plunk/ui';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

interface NavItem {
  nameKey: string;
  href: string;
  icon: React.ComponentType<{className?: string}>;
}

interface NavSection {
  titleKey?: string;
  items: NavItem[];
}

const navigation: NavSection[] = [
  {
    items: [
      {nameKey: 'nav.dashboard', href: '/', icon: LayoutDashboard},
      {nameKey: 'nav.contacts', href: '/contacts', icon: Users},
      {nameKey: 'nav.segments', href: '/segments', icon: Layers},
      {nameKey: 'nav.activity', href: '/activity', icon: Activity},
      {nameKey: 'nav.analytics', href: '/analytics', icon: BarChart3},
    ],
  },
  {
    titleKey: 'nav.automations',
    items: [
      {nameKey: 'nav.templates', href: '/templates', icon: FileText},
      {nameKey: 'nav.workflows', href: '/workflows', icon: Workflow},
    ],
  },
  {
    items: [{nameKey: 'nav.campaigns', href: '/campaigns', icon: Megaphone}],
  },
];

// Deterministically derives a soft two-tone gradient from a string (e.g. an email),
// so every account gets a stable, distinct avatar without storing any image.
function avatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const hue2 = (hue + 45) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${hue2} 75% 45%))`;
}

export function DashboardLayout({children}: DashboardLayoutProps) {
  const router = useRouter();
  const {t, locale, setLocale} = useTranslation();
  const {data: user, mutate: mutateUser} = useUser();
  const {activeProject, availableProjects, setActiveProject} = useActiveProject();
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // Sort projects alphabetically by name
  const sortedProjects = useMemo(() => {
    return [...availableProjects].sort((a, b) => a.name.localeCompare(b.name));
  }, [availableProjects]);

  const handleLogout = useCallback(async () => {
    try {
      // Call the logout endpoint to clear the cookie
      await network.fetch('GET', '/auth/logout');

      // Clear local storage
      localStorage.removeItem('token');
      localStorage.removeItem('activeProjectId');

      // Clear SWR cache for user data
      await mutateUser(null, false);

      // Redirect to login
      await router.push('/auth/login');
    } catch {
      // Even if the API call fails, try to redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('activeProjectId');
      await mutateUser(null, false);
      await router.push('/auth/login');
    }
  }, [mutateUser, router]);

  // Sidebar content (reusable for both desktop and mobile)
  const getSidebarContent = () => (
    <>
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-neutral-200">
        <div className="flex items-center gap-2">
          <Image src="/assets/sagy-logo-azul-profundo.png" alt="Sagy" width={112} height={32} className="h-8 w-auto" />
        </div>
        <button
          onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', metaKey: true, bubbles: true}))}
          className="hidden lg:flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 bg-neutral-100 border border-neutral-200 rounded hover:bg-neutral-200 hover:text-neutral-600 transition-colors cursor-pointer"
        >
          <span>⌘</span>
          <span>K</span>
        </button>
      </div>

      {/* Project Switcher */}
      <div className="p-4 border-b border-neutral-200">
        <DropdownMenu>
          <DropdownMenuTrigger className="group w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg hover:bg-neutral-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-neutral-100 text-neutral-700 flex items-center justify-center text-xs font-medium flex-shrink-0">
                {activeProject?.name.charAt(0).toUpperCase() || 'P'}
              </div>
              <span className="font-medium text-neutral-900 truncate">{activeProject?.name || t('nav.selectProject')}</span>
            </div>
            <ChevronDown className="h-4 w-4 text-neutral-500 flex-shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[var(--radix-dropdown-menu-trigger-width)] max-h-[400px] overflow-y-auto"
          >
            {sortedProjects.map(project => (
              <DropdownMenuItem
                key={project.id}
                onSelect={() => setActiveProject(project)}
                className="gap-2 px-3 py-2 cursor-pointer"
              >
                <div className="h-6 w-6 rounded-md bg-neutral-100 text-neutral-700 flex items-center justify-center text-xs font-medium flex-shrink-0">
                  {project.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-neutral-900 text-left flex-1 truncate">{project.name}</span>
                {activeProject?.id === project.id && (
                  <div className="ml-auto h-1.5 w-1.5 rounded-full bg-neutral-900 flex-shrink-0" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="gap-2 px-3 py-2 cursor-pointer text-neutral-700">
              <Link href="/projects/create" onClick={() => setShowMobileMenu(false)}>
                <Plus className="h-4 w-4" />
                <span>{t('nav.createProject')}</span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {navigation.map((section, sectionIndex) => (
          <div key={sectionIndex} className={sectionIndex > 0 ? 'mt-6' : ''}>
            {section.titleKey && (
              <p className="px-3 mb-2 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                {t(section.titleKey)}
              </p>
            )}
            <div className="space-y-1">
              {section.items.map(item => {
                const isActive =
                  item.href === '/' ? router.pathname === item.href : router.pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.nameKey}
                    href={item.href}
                    onClick={() => setShowMobileMenu(false)}
                    className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      isActive
                        ? 'bg-neutral-100 text-neutral-900'
                        : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {t(item.nameKey)}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Settings & User Menu */}
      <div className="border-t border-neutral-200 p-3 space-y-1">
        <a
          href={WIKI_URI}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <BookOpen className="h-5 w-5" />
          {t('nav.documentation')}
        </a>

        <Link
          href="/settings"
          onClick={() => setShowMobileMenu(false)}
          className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
            router.pathname.startsWith('/settings')
              ? 'bg-neutral-100 text-neutral-900'
              : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
          }`}
        >
          <Settings className="h-5 w-5" />
          {t('nav.settings')}
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger className="group w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <div
              className="h-5 w-5 rounded-full text-white flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
              style={{background: avatarGradient(user?.email ?? '')}}
            >
              {user?.email?.charAt(0).toUpperCase() ?? '?'}
            </div>
            <span className="flex-1 text-left truncate">{t('nav.account')}</span>
            <ChevronDown className="h-4 w-4 text-neutral-500 transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
            <DropdownMenuLabel className="px-3 py-2 font-normal text-xs text-neutral-500 truncate">
              {user?.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2 px-3 py-1.5 font-normal text-xs text-neutral-500">
              <Globe className="h-3.5 w-3.5" />
              {t('nav.language')}
            </DropdownMenuLabel>
            {UI_LANGUAGES.map(language => (
              <DropdownMenuItem
                key={language.code}
                onSelect={() => setLocale(language.code)}
                className="gap-2 px-3 py-2 cursor-pointer"
              >
                <span>{language.flag}</span>
                <span className="flex-1 text-left">{language.nativeName}</span>
                {locale === language.code && <Check className="h-4 w-4 text-neutral-900" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void handleLogout()}
              className="gap-2 px-3 py-2 cursor-pointer text-red-600 focus:text-red-600"
            >
              <LogOut className="h-4 w-4" />
              <span>{t('nav.logout')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-neutral-50">
      {/* Desktop Sidebar - Hidden on mobile */}
      <div className="hidden lg:flex w-64 bg-white border-r border-neutral-200 flex-col">
        {getSidebarContent()}
      </div>

      {/* Mobile Sidebar Overlay */}
      {showMobileMenu && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setShowMobileMenu(false)}>
          <div className="absolute inset-0 bg-black/50" />
        </div>
      )}

      {/* Mobile Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white transform transition-transform duration-300 ease-in-out lg:hidden ${
          showMobileMenu ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">{getSidebarContent()}</div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header - Only visible on mobile */}
        <div className="lg:hidden h-16 bg-white border-b border-neutral-200 flex items-center px-4">
          <button
            onClick={() => setShowMobileMenu(true)}
            className="p-2 rounded-lg hover:bg-neutral-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={t('nav.openMenu')}
          >
            <Menu className="h-6 w-6 text-neutral-900" />
          </button>
          <div className="flex items-center gap-2 ml-4">
            <Image src="/assets/sagy-logo-azul-profundo.png" alt="Sagy" width={98} height={28} className="h-7 w-auto" />
          </div>
        </div>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
            <OnboardingBanner />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
