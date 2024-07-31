'use client';

import type { PublicWebsiteSettings } from '@/api/site-settings';
import type { SystemCheck } from '@/api/system';
import { getMe, type MeInfo } from '@/api/users';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { ChatsProvider } from '@/components/chat/chat-hooks';
import { SystemCheckProvider } from '@/components/system/SystemCheckProvider';
import { Toaster } from '@/components/ui/sonner';
import { SettingProvider } from '@/components/website-setting-provider';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import useSWR from 'swr';

export interface RootProvidersProps {
  me: MeInfo | undefined;
  children: ReactNode;
  settings: PublicWebsiteSettings;
  systemCheck: SystemCheck;
}

export function RootProviders ({ me, settings, systemCheck, children }: RootProvidersProps) {
  const { data, isValidating, isLoading } = useSWR('api.users.me', getMe, { fallbackData: me, revalidateOnMount: !me, revalidateOnFocus: false });

  return (
    <SystemCheckProvider systemCheck={systemCheck}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <SettingProvider
          value={settings}>
          <AuthProvider me={data} isLoading={isLoading} isValidating={isValidating}>
            <ChatsProvider>
              {children}
              <Toaster />
            </ChatsProvider>
          </AuthProvider>
        </SettingProvider>
      </ThemeProvider>
    </SystemCheckProvider>
  );
}
