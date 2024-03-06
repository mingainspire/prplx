'use client';

import { supportedProviders } from '@/app/(main)/(admin)/settings/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Form, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { fetcher } from '@/lib/fetch';
import clsx from 'clsx';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import useSWR from 'swr';

export function Signin ({ callbackUrl }: { callbackUrl?: string }) {
  const router = useRouter();

  const [error, setError] = useState<string>();

  const form = useForm<{ username: string; password: string }>();
  const { providers, loading: providersLoading } = useCustomProviders();

  const handleSubmit = form.handleSubmit(async (data) => {
    setError(undefined);
    const res = await signIn('credentials', {
      callbackUrl: refineCallbackUrl(callbackUrl),
      redirect: false,
      ...data,
    });
    if (!res) {
      setError('UnknownError');
      return;
    }
    if (res.error) {
      setError(res.error);
    }
    if (res.url) {
      router.replace(res.url);
      router.refresh();
    }
  });

  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            Could not login with provided credentials.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {providersLoading && <Skeleton className="w-full h-10 rounded col-span-2" />}
        {!providersLoading &&
          providers.map((provider) => (
            <CustomProviderItem
              key={provider.name}
              provider={provider.name}
              className={providers?.length === 2 ? '' : 'col-span-2'}
            />
          ))}
      </div>
      {providers?.length > 0 && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t"></span>
          </div>
          <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
          </div>
        </div>
      )}
      <Form {...form}>
        <form className="space-y-2" onSubmit={handleSubmit}>
          <FormItem>
            <FormLabel htmlFor='username'>Username</FormLabel>
            <FormField
              name="username"
              render={({ field }) => (
                <Input placeholder="x@example.com" {...field} />
              )}
            />
          </FormItem>
          <FormItem>
            <FormLabel htmlFor='password'>Password</FormLabel>
            <FormField
              name="password"
              render={({ field }) => (
                <Input type="password" {...field} />
              )}
            />
          </FormItem>
          <Button>Login</Button>
        </form>
      </Form>
    </>
  );
}

function refineCallbackUrl (url: string | undefined) {
  if (!url) {
    return `${location.origin}`;
  }
  if (/auth\/login/.test(url)) {
    return `${location.origin}`;
  } else {
    return url;
  }
}

export function CustomProviderItem (props: { provider: string, className?: string }) {
  const usp = useSearchParams();
  const callbackUrl = usp.get('callbackUrl') ?? '/';

  const { provider, className } = props;
  const providerMemo = useMemo(() => {
    return supportedProviders.find((p) => p.id === provider);
  }, [provider]);

  return (
    <>
      <Button
        className={clsx('w-full h-10', className)}
        variant="outline"
        onClick={() => {
          signIn(provider, {
            callbackUrl,
          });
        }}
      >
        {providerMemo?.Icon && (
          <providerMemo.Icon className="w-6 h-6 inline mr-2" />
        )}
        <span className="w-20 text-center">{providerMemo?.name || provider}</span>
      </Button>
    </>
  );
}

export function useCustomProviders () {
  const [providers, setProviders] = useState<
    { name: string; enabled: number }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useSWR(
    [
      'get',
      `/api/v1/authentication-providers`,
      {
        enabled: true,
      },
    ],
    fetcher<{ name: string; enabled: number }[]>,
    {
      onSuccess: (data) => {
        setProviders(data);
        setLoading(false);
      },
    },
  );

  return { providers, loading };
}
