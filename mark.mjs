import puppeteer from 'puppeteer';
// Or import puppeteer from 'puppeteer-core';

// Launch the browser and open a new blank page
const browser = await puppeteer.launch({ headless: false, userDataDir: './my-user-data' ,args: [
    '--start-maximized', // 设置浏览器语言
  ], defaultViewport: null});
const page = await browser.newPage();
// Navigate the page to a URL.
await page.goto('https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/markpaper?courseid=241341550&id=168065687&start=&classid=127650867&groupid=-1&ut=t&cpi=342110777&hideRetest=false&groupIds=');
const processPage = async (page) => {
await page.setViewport({width: 1080, height: 1024});
await page.waitForSelector('#index_1 > div > div:nth-child(1) > div > div.mark_answer.topicStudentAnswer > div.mark_score > div.totalScore.fl > input')

for (let i = 1; i <= 9; i++) {
    const scoreSelector=await page.locator('#index_'+i.toString()+' > div > div:nth-child(1) > div > div.mark_answer.topicStudentAnswer > div.mark_score > div.totalScore.fl > input').waitHandle();
    const value=await scoreSelector?.evaluate(el => el.value);
    console.log(value)
    if(value==5){
    console.log("满分");
    await page.locator("#index_"+i.toString()+"> div > div:nth-child(2) > div.commentArea.fr > div:nth-child(3) > ul.quickScoreLi.fastScoreList > li:nth-child(1) ").click();
    
    }  else{   
       await page.locator("#index_"+i.toString()+"> div > div:nth-child(2) > div.commentArea.fr > div:nth-child(3) > ul.quickScoreLi.fastScoreList > li:nth-child(6)").click();

    }



}
await page.locator("#index_10 > div.clearfix.topicArea_commentArea > div.commentArea.fr > div:nth-child(3) > ul > li:nth-child(1)").click();
await page.locator("#submitMarking > div.gradeFooter > div.footRight.fr > a.foot-btn-submit-next.jb_btn.jb_btn_160.fr").click();

await page.setViewport({
    width: 800,
    height: 600,
    deviceScaleFactor:2,
  });
await page.waitForNavigation({ waitUntil: 'domcontentloaded' })
processPage(page)

}
await processPage(page);
