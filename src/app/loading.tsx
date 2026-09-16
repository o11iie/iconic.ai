import { LoadingState } from '@/components/ui/states';

export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <LoadingState label="Loading VEO" />
    </div>
  );
}
