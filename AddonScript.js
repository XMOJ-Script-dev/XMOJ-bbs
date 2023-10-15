if (localStorage.getItem("UserScript-ImportantNotice-20231015") == null) {
    let InputValue = prompt("警告！警告！警告！请仔细阅读以下内容！请检查你是否安装了两个脚本! 如果是, 请删除一个. 如果你已经明白了这些内容，那么请在下方输入“我已知晓”并点击确定。");
    if (InputValue != "我已知晓") {
        alert("您输入的内容不正确！请重新安装用户脚本！安装指南在https://www.seanoj.edu.eu.org/#Install。");
        window.location.href = "https://www.seanoj.edu.eu.org/#Install";
    }
    else {
        localStorage.setItem("UserScript-ImportantNotice-20231015", "true")
    }
}
