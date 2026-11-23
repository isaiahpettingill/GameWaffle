// Each digit is one row of three pixels. The built-in face uses small capitals.
const rows={
  A:'25755',B:'65656',C:'34443',D:'65556',E:'74647',F:'74644',G:'34553',
  H:'55755',I:'72227',J:'11152',K:'55655',L:'44447',M:'57755',N:'57775',
  O:'25552',P:'65644',Q:'25573',R:'65655',S:'34216',T:'72222',U:'55557',
  V:'55552',W:'55775',X:'55255',Y:'55222',Z:'71247',
  0:'75557',1:'26227',2:'71247',3:'71217',4:'55711',5:'74617',6:'64757',
  7:'71122',8:'75757',9:'75711','?':'71202','!':'22202','.':'00002',
  ',':'00024',':':'02020',';':'02024',"'":'22000','"':'55000','-':'00700',
  '+':'02720','/':'11244','(':'12421',')':'42124','=':'07070',' ':'00000',
  '%':'51245','*':'05250','_':'00007','#':'57575','<':'12421','>':'42124'
};
export function defaultFont(){
  const width=96,height=48,rgba=Buffer.alloc(width*height*4);
  for(let i=0;i<96;i++){
    const glyph=rows[String.fromCharCode(i+32).toUpperCase()]??rows['?'];
    for(let y=0;y<5;y++)for(let x=0;x<3;x++)if(Number(glyph[y]) & (4>>x)){
      const offset=4*((Math.floor(i/16)*8+y+1)*width+(i%16)*6+x+1);
      rgba.fill(255,offset,offset+4);
    }
  }
  return {width,height,rgba};
}
