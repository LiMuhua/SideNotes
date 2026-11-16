'use strict';
/** @brief 读取原型启动标记，普通入口不显示测试按钮。 */
(function initializePrototypeFlags(){
  const params=new URLSearchParams(window.location.search);
  const demo=params.get('demo')==='1'||params.get('mode')==='demo';
  // 原型的版本比现有应用 0.7.3 高一版；演示模式（?demo=1）下「检查更新」模拟发现下一版。
  window.PrototypeFlags=Object.freeze({demo:demo,version:'0.7.4',nextVersion:'0.7.5',availableVersion:demo&&params.get('update')==='1'?'0.7.5':''});
})();
