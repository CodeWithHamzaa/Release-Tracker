'use client';

import { useRouter } from 'next/navigation';
import { Navbar } from '@/src/components/Navbar';
import { AddRecordForm } from '@/src/components/AddRecordForm';

export default function AddRecordPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300">
      <Navbar currentPath="/add" onNavigate={(path) => router.push(path)} />
      <AddRecordForm
        onSuccess={() => {
          router.push('/');
        }}
        onCancel={() => {
          router.push('/');
        }}
      />
    </div>
  );
}
