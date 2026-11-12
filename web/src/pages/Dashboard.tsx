// 대시보드: 화면 바로가기만 (상세 내용은 각 화면)
import type { AppData } from "../data";
import { PageHead } from "../components/PageHead";
import { QuickLinks } from "../components/QuickLinks";
import { useAuth } from "../auth/AuthContext";

export function Dashboard({ data }: { data: AppData }) {
  const { regions } = data;
  const priority = regions.filter((r) => r.classification === "A");
  const { profile } = useAuth();

  return (
    <div className="page">
      <PageHead
        tags={["강남·서초·송파 67개 동"]}
        title={
          <>
            충전소를 먼저 늘릴 동네 <span className="accent-num">{priority.length}곳</span>
          </>
        }
        lede="보고 싶은 화면을 고르세요. 지역·지표 분석은 누구나, 데이터 운영은 역할을 받은 뒤 볼 수 있습니다."
      />

      <QuickLinks role={profile?.role} />
    </div>
  );
}
