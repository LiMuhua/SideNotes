'use strict';
/** @brief 读取原型启动标记，普通入口不显示测试按钮。 */
(function initializePrototypeFlags(){
  const params=new URLSearchParams(window.location.search);
  const demo=params.get('demo')==='1'||params.get('mode')==='demo';
  window.PrototypeFlags=Object.freeze({demo:demo,version:'0.5.0',availableVersion:demo&&params.get('update')==='1'?'0.5.1':''});
})();
