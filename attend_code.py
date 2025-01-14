import requests
import json
cookies = {
    '_ga': 'GA1.3.1381716507.1711415172',
    '_ga_QYKCGTHFGK': 'GS1.3.1728471665.1.1.1728471688.0.0.0',
    'JSESSIONID': '308AED6DDCF9F77B303AE268B192703A',
}

headers = {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    # 'Cookie': '_ga=GA1.3.1381716507.1711415172; _ga_QYKCGTHFGK=GS1.3.1728471665.1.1.1728471688.0.0.0; JSESSIONID=308AED6DDCF9F77B303AE268B192703A',
    'Pragma': 'no-cache',
    'Referer': 'https://newca.zjtongji.edu.cn/attend/start/index.html?t=1736736280533',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Edg/131.0.0.0',
    'X-Requested-With': 'XMLHttpRequest',
    'access-token': 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3MzY4MTM3NzAsInVzZXJuYW1lIjoiejIwMjIwMjMwODA0In0.jUakhE5yLP5kOSkzF2SpAIIrqeulEXwpGhr3jkWEc4w',
    'sec-ch-ua': '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
}

params = {
    'page': '1',
    'rows': '100',
    'sort': 'c_day',
    'order': 'desc',
    'dateEnd': '',
    'dateStart': '',
    'courseId': '',
    'className': '',
    '_t': '1736736287620',
}

response = requests.get(
    'https://newca.zjtongji.edu.cn/attendng/attend/m/teaRecord/list',
    params=params,
    cookies=cookies,
    headers=headers,
)
data=response.json()

# 筛选 "className" 和 "courseName" 的记录
filtered_ids = [
     { "id" :record["id"],"day":record['cday']}
    for record in data["result"]["records"]
    if record["className"] == "信安23-01" and record["courseName"] == "Linux操作系统安全配置"
]

#print(filtered_ids)


def course(day,stu):
    response = requests.get(
        f'https://newca.zjtongji.edu.cn/attendng/attend/m/teaRecord/getById/{stu["id"]}?_t=1736737564790',
        cookies=cookies,
        headers=headers,
    )
    data=response.json()
    id=data["result"]['scheduleId']

    params = {
        'scheduleId': id,
        'stuName': '',
        'lateStatus': '',
        '_t': '1736737716679',
    }

    response = requests.get(
        'https://newca.zjtongji.edu.cn/attendng/attend/m/stuRecord/getStuRecordsByStatus',
        params=params,
        cookies=cookies,
        headers=headers,
    )
    data=response.json()
    #print(json.dumps(data, ensure_ascii=False))
    for stu in data["result"]['2']:
        print(day+','+stu['stuName']+','+stu['leaveReason'])
    for stu in data["result"]['1']:
        print(day+','+stu['stuName']+',缺勤')
#print(len(filtered_ids))
print("日期,姓名,原因")
for stu in filtered_ids:
    course(stu['day'],stu)
