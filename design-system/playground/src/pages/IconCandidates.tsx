/**
 * 图标候选（临时页面）：十几版风格各不相同的应用图标，供挑选新的应用图标。
 *
 * 候选图标与对比页放在 design-system/icon-candidates/，这里用内嵌框架原样显示，
 * 不受主题与明暗设置影响。图标选定后，这个页面连同候选文件夹一起删除。
 */

export function IconCandidatesPage() {
  return <iframe className="pg-frame" src="/design-system/icon-candidates/index.html" title="图标候选" />;
}
