import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Workspace from './workspace';
export const dynamic = 'force-dynamic';
export default async function Page(){const session=await auth.api.getSession({headers:await headers()});if(!session)redirect('/sign-in');return <Workspace identity={{name:session.user.name,email:session.user.email}}/>;}
