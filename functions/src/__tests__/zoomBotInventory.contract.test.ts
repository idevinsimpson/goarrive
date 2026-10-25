import {RealZoomProvider} from '../zoom';
afterEach(()=>jest.restoreAllMocks());
test('inventory paginates bounded GETs and projects only timing and identity',async()=>{
 const calls:string[]=[];
 jest.spyOn(global,'fetch').mockImplementation(async(url)=>{const u=String(url);calls.push(u);return {ok:true,status:200,json:async()=>u.includes('/oauth/token')?{access_token:'synthetic',expires_in:3600}:u.includes('type=live')?{meetings:[{id:123,host_id:'host',type:2,start_time:'2026-10-25T12:00:00Z',duration:45,start_url:'SECRET'}],next_page_token:''}:u.includes('next_page_token')?{meetings:[],next_page_token:''}:{meetings:[{id:123,host_id:'host',type:2,start_time:'2026-10-25T12:00:00Z',duration:45,password:'SECRET'}],next_page_token:'next'}} as Response;});
 const result=await new RealZoomProvider('account','synthetic','synthetic').inspectHostOccupancy('host');
 expect(result).toEqual([{meetingId:'123',startMs:Date.parse('2026-10-25T12:00:00Z'),endMs:Date.parse('2026-10-25T12:45:00Z'),live:true}]);expect(JSON.stringify(result)).not.toContain('SECRET');expect(calls.filter(u=>u.includes('/meetings?'))).toHaveLength(3);
});
test('repeating pagination or wrong host fails closed with generic error',async()=>{
 jest.spyOn(global,'fetch').mockResolvedValue({ok:true,status:200,json:async()=>({meetings:[{id:123,host_id:'wrong'}],next_page_token:''})} as Response);
 await expect(new RealZoomProvider('account','synthetic','synthetic').inspectHostOccupancy('host')).rejects.toThrow('Zoom host inventory unavailable');
});
test('cold OAuth error never exposes raw provider body in inventory failure',async()=>{
 jest.resetModules();const {RealZoomProvider:Fresh}=await import('../zoom');
 jest.spyOn(global,'fetch').mockResolvedValue({ok:false,status:401,text:async()=> 'PRIVATE_SENTINEL'} as Response);
 await expect(new Fresh('account','synthetic','synthetic').inspectHostOccupancy('host')).rejects.toThrow('Zoom host inventory unavailable');
});

test('inventory rejects a repeated pagination token instead of accepting a truncated list',async()=>{
 jest.spyOn(global,'fetch').mockResolvedValue({ok:true,status:200,json:async()=>({meetings:[],next_page_token:'loop'})} as Response);
 await expect(new RealZoomProvider('account','synthetic','synthetic').inspectHostOccupancy('host')).rejects.toThrow('Zoom host inventory unavailable');
 expect(global.fetch).toHaveBeenCalledTimes(2);
});
