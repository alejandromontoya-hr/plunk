import {zodResolver} from '@hookform/resolvers/zod';
import {AuthenticationSchemas} from '@plunk/shared';
import {
  Button,
  Card,
  CardContent,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  IconSpinner,
  Input,
} from '@plunk/ui';
import {AnimatePresence, motion} from 'framer-motion';
import {NextSeo} from 'next-seo';
import Image from 'next/image';
import Link from 'next/link';
import {useRouter} from 'next/router';
import React, {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import type {z} from 'zod';

import {useTranslation} from '../../lib/i18n';
import {network} from '../../lib/network';

const dotGrid = {
  backgroundColor: '#fafafa',
  backgroundImage: 'radial-gradient(#e5e7eb 1px, transparent 1px)',
  backgroundSize: '20px 20px',
};


const Wordmark = () => (
  <div className="flex items-center justify-center">
    <Image src="/assets/sagy-logo-azul-profundo.png" alt="Sagy" width={140} height={40} priority className="h-10 w-auto" />
  </div>
);

export default function ResetPassword() {
  const {t} = useTranslation();
  const router = useRouter();
  const {token} = router.query;

  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const form = useForm<z.infer<typeof AuthenticationSchemas.resetPassword>>({
    resolver: zodResolver(AuthenticationSchemas.resetPassword),
    defaultValues: {
      token: '',
      newPassword: '',
    },
  });

  useEffect(() => {
    if (token && typeof token === 'string') {
      form.setValue('token', token);
    }
  }, [token, form]);

  async function onSubmit(values: z.infer<typeof AuthenticationSchemas.resetPassword>) {
    try {
      const response = await network.fetch<{success: boolean}, typeof AuthenticationSchemas.resetPassword>(
        'POST',
        '/auth/reset-password',
        values,
      );

      if (response.success) {
        setStatus('success');
        setTimeout(() => {
          void router.push('/auth/login');
        }, 2000);
      } else {
        setStatus('error');
        setErrorMessage(t('auth.resetPassword.failed'));
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : t('auth.errors.somethingWentWrong'));
    }
  }

  if (!token) {
    return (
      <>
        <NextSeo title={t('auth.resetPassword.seoTitle')} />
        <div className="min-h-screen flex items-center justify-center py-12" style={dotGrid}>
          <div className="flex flex-col gap-6 max-w-md w-full px-4">
            <Wordmark />
            <Card>
              <CardContent className="p-8">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="h-12 w-12 rounded-full bg-neutral-100 flex items-center justify-center">
                    <svg className="h-6 w-6 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <h1 className="text-xl font-bold tracking-tight">{t('auth.resetPassword.invalidTitle')}</h1>
                    <p className="text-sm text-neutral-500">
                      {t('auth.resetPassword.invalidSubtitle')}
                    </p>
                  </div>
                  <Button asChild className="mt-2">
                    <Link href="/auth/login">{t('auth.resetPassword.backToLogin')}</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <NextSeo title={t('auth.resetPassword.seoTitle')} />
      <div className="min-h-screen flex items-center justify-center py-12" style={dotGrid}>
        <div className="flex flex-col gap-6 max-w-md w-full px-4">
          <Wordmark />
          <Card>
            <CardContent className="p-0">
              <AnimatePresence mode="wait">
                {status === 'success' ? (
                  <motion.div
                    key="success"
                    initial={{opacity: 0, scale: 0.97}}
                    animate={{opacity: 1, scale: 1}}
                    exit={{opacity: 0}}
                    transition={{duration: 0.2}}
                    className="p-8"
                  >
                    <div className="flex flex-col items-center gap-4 text-center">
                      <div className="h-12 w-12 rounded-full bg-neutral-100 flex items-center justify-center">
                        <svg className="h-6 w-6 text-neutral-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <h1 className="text-xl font-bold tracking-tight">{t('auth.resetPassword.successTitle')}</h1>
                        <p className="text-sm text-neutral-500">{t('auth.resetPassword.successSubtitle')}</p>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="form" initial={{opacity: 1}} exit={{opacity: 0}} className="p-8">
                    <Form {...form}>
                      <form
                        onSubmit={e => {
                          e.preventDefault();
                          void form.handleSubmit(onSubmit)(e);
                        }}
                      >
                        <div className="flex flex-col gap-6">
                          <div className="flex flex-col gap-1.5">
                            <h1 className="text-2xl font-bold tracking-tight">{t('auth.resetPassword.title')}</h1>
                            <p className="text-sm text-neutral-500">{t('auth.resetPassword.subtitle')}</p>
                          </div>

                          <FormField
                            control={form.control}
                            name="newPassword"
                            render={({field}) => (
                              <FormItem>
                                <FormLabel>{t('auth.fields.newPassword')}</FormLabel>
                                <FormControl>
                                  <Input placeholder={t('auth.fields.passwordPlaceholder')} type="password" autoFocus {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <AnimatePresence>
                            {status === 'error' && (
                              <motion.p
                                initial={{opacity: 0, y: -8}}
                                animate={{opacity: 1, y: 0}}
                                exit={{opacity: 0, y: -8}}
                                transition={{duration: 0.15}}
                                className="text-sm text-red-500"
                              >
                                {errorMessage}
                              </motion.p>
                            )}
                          </AnimatePresence>

                          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? (
                              <>
                                <IconSpinner size="sm" />
                                {t('auth.resetPassword.submitting')}
                              </>
                            ) : (
                              t('auth.resetPassword.submit')
                            )}
                          </Button>

                          <p className="text-center text-sm text-neutral-500">
                            {t('auth.resetPassword.rememberPassword')}{' '}
                            <Link
                              href="/auth/login"
                              className="text-neutral-900 underline underline-offset-4 hover:text-neutral-600 transition-colors"
                            >
                              {t('auth.resetPassword.backToLogin')}
                            </Link>
                          </p>
                        </div>
                      </form>
                    </Form>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
