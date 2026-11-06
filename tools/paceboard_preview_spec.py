"""Fixtures and one-shot native animation timelines for the Paceboard proposal."""
SCREENS = [
 ('choose-walk','Choose Walking','PB_CHOOSE_WALK'),
 ('choose-run','Choose Running','PB_CHOOSE_RUN'),
 ('choose-ride','Choose Cycling','PB_CHOOSE_RIDE'),
 ('choose-history','Choose History','PB_CHOOSE_HISTORY'),
 ('gps','Finding GPS','PB_GPS'),('ready','GPS ready','PB_READY'),
 ('gps-error','GPS unavailable','PB_GPS_ERROR'),('gps-improving','GPS accuracy improving','PB_GPS_CLOSE'),
 ('three','Countdown 3','PB_THREE'),('two','Countdown 2','PB_TWO'),
 ('one','Countdown 1','PB_ONE'),('go','Go','PB_GO'),
 ('run','Running','PB_RUN'),('walk','Walking','PB_WALK'),('ride','Cycling','PB_RIDE'),
 ('first','First kilometre','PB_FIRST'),('offline','Phone disconnected','PB_OFFLINE'),
 ('no-hr','HR measuring','PB_NO_HR'),('long','Long values','PB_LONG'),
 ('split','Kilometre split','PB_SPLIT'),('laps','Kilometres page','PB_LAPS'),
 ('zones','Time in zones','PB_ZONES'),('heart','Heart rate history','PB_HEART'),
 ('paused','Paused','PB_PAUSED'),('confirm','Finish confirmation','PB_CONFIRM'),
 ('saved','Saved recap','PB_SAVED'),('upload','Strava upload','PB_UPLOAD'),
 ('exit','Leave during upload','PB_EXIT'),('history','History list','PB_HISTORY'),
 ('detail','History detail','PB_DETAIL'),('recovery','Interrupted recording','PB_RECOVERY'),
 ('discard','Discard confirmation','PB_DISCARD'),('zone-high','Zone change','PB_ZONE_HIGH'),
 ('after-split','New Last KM','PB_AFTER_SPLIT')
]
# key, target screen, C effect, ms. End frames resolve to their static scene.
MOTIONS = [
 ('pick-walk','choose-walk','FX_PICK',240),('pick-run','choose-run','FX_PICK',240),
 ('pick-ride','choose-ride','FX_PICK',240),('pick-history','choose-history','FX_PICK',240),
 ('gps-orbit','gps','FX_ORBIT',3400),('gps-orbit-close','gps-improving','FX_ORBIT',3400),
 ('gps-fix','gps-improving','FX_GPS_FIX',320),('gps-lock','ready','FX_LOCK',480),
 ('beat-three','three','FX_BEAT',280),('beat-two','two','FX_BEAT',280),('beat-one','one','FX_BEAT',280),
 ('start','run','FX_START',440),('split-in','split','FX_SPLIT_IN',280),
 ('split-out','after-split','FX_SPLIT_OUT',240),('pause','paused','FX_PAUSE',200),
 ('resume','run','FX_RESUME',200),('page-laps','laps','FX_LAPS',240),
 ('page-zones','zones','FX_ZONES',240),('page-heart','heart','FX_HEART',240),
 ('finish-sheet','confirm','FX_CONFIRM',240),('saved','saved','FX_SAVED',760),
 ('zone-change','zone-high','FX_ZONE',320),('upload','upload','FX_UPLOAD',720),
 ('open-gps','gps','FX_PUSH',240),('open-history','history','FX_PUSH',240),
 ('hr-sample','run','FX_HR',120)
]
