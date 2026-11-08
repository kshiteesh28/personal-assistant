// Evaluation-only synthetic requests. Never packaged into seed/replay or personal learning.
// Each entry adds a different request construction; slot substitutions do not add rows.
export const additionalActionTests = {
 1: [
  'add <title> as something I need to get done','put a checkbox beside <title> on my todo list','please log a task titled <title>','can you add a task for <title>','I have another task to add: <title>','append <title> to the things I need to do','make <title> an open task','create an unfinished item named <title>','add the following work item: <title>','save <title> in my pending tasks','I would like to track <title> as work','put <title> in the task backlog'
 ],
 2: [
  'please check the task <title> off my list','mark the todo named <title> as finished','change the status of task <title> to done','the work item <title> is ready to mark complete','set my todo <title> to done now','close out the outstanding item <title>','please finish the task called <title>','remove the unfinished status from task <title>','check off the work item titled <title>','mark task <title> complete for me','put the task <title> in the completed category','I want to mark <title> as a completed task'
 ],
 3: [
  'tell me what remains on my task list','which work items have not been completed','show me the todos still open','can I hear my pending tasks','bring up my unfinished work list','let me review the tasks awaiting completion','what is left for me to get done','give me the list of incomplete work','display the open items in my todo list','which tasks have I yet to finish','read through my current task backlog','show the work that is still outstanding'
 ],
 4: [
  'please preserve this as a note: <body>','put the following in a new note: <body>','add a notebook entry with this text: <body>','here is some text to save in a note: <body>','write this information into my notes: <body>','keep a written record of this: <body>','create a notebook entry saying <body>','save these words for later as a note: <body>','I have a note to record: <body>','store this sentence in my notebook: <body>','make a fresh note containing <body>','please jot down the following: <body>'
 ],
 5: [
  'show me what is in my notes collection','can you read back my notebook entries','I want to review the notes already saved','bring my written notes into view','give me the notes currently on record','which notebook entries have I kept','list the information I saved in notes','read the entries from my notebook','display my collection of written notes','let us look through my saved notes','tell me which notes are stored','show the notebook contents'
 ],
 6: [
  'create an alert at <date> telling me to <title>','please remind me about <title> when it is <date>','at <date> tell me it is time to <title>','set up a future nudge for <title> at <date>','I need an alert for <title>, due at <date>','make a reminder titled <title> that fires at <date>','give me a notification to <title> at <date>','please arrange a reminder to <title> for <date>','schedule a reminder about <title> for <date>','when <date> arrives, remind me to <title>','put <title> in reminders with a time of <date>','a new reminder: <title>, at <date>'
 ],
 7: [
  'update the existing reminder <title> so it fires at <date>','retime my reminder for <title> to <date>','please change reminder <title> from its old time to <date>','the alert named <title> needs to fire at <date> now','reschedule the alert about <title> for <date>','move the existing nudge for <title> to <date>','use <date> as the replacement time for reminder <title>','give <title> a different reminder time: <date>','switch the scheduled reminder <title> to <date>','please revise reminder <title> to be due at <date>','make <date> the time for the already saved reminder <title>','change the firing time on reminder <title> to <date>'
 ],
 8: [
  'snooze the alert for <title> another <duration>','please postpone my current reminder <title> for <duration>','give me a further <duration> on the reminder <title>','delay reminder <title> by an extra <duration>','let the alert <title> ring again after <duration>','hold off on the reminder <title> for <duration>','push reminder <title> later by <duration>','I need to snooze <title> for <duration>','repeat the existing reminder <title> after <duration>','put a <duration> snooze on reminder <title>','leave reminder <title> for another <duration>','wait an additional <duration> before alerting me to <title>'
 ],
 9: [
  'please cancel the alert I set for <title>','remove the saved reminder about <title>','disable the existing reminder named <title>','I want the reminder for <title> cancelled','take the reminder titled <title> away','clear my scheduled nudge for <title>','discard the reminder entry for <title>','please turn off the alert called <title>','cancel the notification reminder for <title>','delete my previously saved reminder <title>','remove <title> from the scheduled alerts','the reminder about <title> is no longer needed; cancel it'
 ],
 10: [
  'tell me which reminders are currently scheduled','let me review my future alerts','show me everything in the reminders list','what alerts have not fired yet','give me the list of saved reminders','read my outstanding reminder entries','display the reminders that are still set','which future nudges are on record','bring up the alerts I have scheduled','what reminder notifications are waiting','list all the reminders you are keeping for me','can you show my existing alerts'
 ],
 11: [
  'create a calendar appointment for <title> starting <date> for <duration>','please reserve a meeting slot at <date> for <title>, lasting <duration>','put a <duration> appointment named <title> at <date>','I need a calendar block for <title>: <date>, <duration>','book a new meeting about <title> for <duration> at <date>','set a calendar event to <title> at <date> for <duration>','allocate <duration> on my calendar at <date> to <title>','please schedule <duration> for a meeting titled <title> at <date>','enter an appointment called <title> at <date> lasting <duration>','add <title> as a calendar event at <date> for <duration>','arrange a calendar slot for <title> at <date> with length <duration>','start a new meeting called <title> at <date> and make it <duration> long'
 ],
 12: [
  'retime the calendar meeting <title> to <date>','the existing meeting named <title> must move to <date>','please give appointment <title> a replacement start time of <date>','shift the start of the booked event <title> to <date>','change my already scheduled meeting <title> to <date>','put the calendar appointment <title> at <date> rather than its current time','revise when event <title> begins to <date>','reschedule my appointment about <title> for <date>','move the start time for <title> on my calendar to <date>','update the booked appointment <title> with start <date>','replace the beginning time of meeting <title> with <date>','make <date> the new start for my existing meeting <title>'
 ],
 13: [
  'please cancel my booked appointment <title>','remove the existing calendar entry for <title>','I want to call off the scheduled meeting <title>','delete the meeting named <title> from my diary','unbook the calendar event called <title>','please take the appointment <title> off my calendar','cancel my calendar slot for <title>','clear the meeting entry titled <title>','drop the appointment about <title> from the schedule','remove my booking for the meeting <title>','the calendar event <title> is no longer needed; cancel it','get the scheduled appointment <title> off my agenda'
 ],
 14: [
  'tell me what is booked on the calendar','let me review my calendar appointments','show me the meetings already in my diary','can you read my current agenda','bring up my booked calendar events','which appointments do I have scheduled','give me the calendar overview','list the meetings on my schedule','what is currently in my calendar','display my scheduled appointments','read back the events in my diary','show my agenda of existing meetings'
 ],
 15: [
  'let me review my timeline history','display the sequence of entries in my timeline','read my activity timeline from start to finish','bring up the timeline of recorded work','what is recorded in my timeline view','give me the chronological activity record','show the entries along my timeline','I want to see my activity history as a timeline','read through my chronological event list','display the ordered history of my activity','list what appears in the work timeline','bring the current timeline into view'
 ],
 16: [
  'propose how I should block out my workday','please turn my tasks into a suggested plan','draft a daily schedule for my pending work','I would like a proposal for arranging today','build a proposed plan from my unfinished tasks','suggest a sequence of work blocks for the day','prepare a draft timetable for my tasks','help organize my workload into a daily plan','make a proposed focus schedule','give me a plan suggestion for the working day','draft time blocks for the work I have left','come up with a schedule proposal for my day'
 ],
 17: [
  'please apply the pending workday proposal','use the proposed schedule we have already made','commit the focus blocks in the saved plan','put the current proposed timetable into use','I accept the daily schedule proposal','go ahead and apply the draft plan','make the already proposed plan take effect','confirm and apply the pending focus schedule','use the draft timetable as my actual plan','activate the existing workday proposal','implement the daily time blocks you proposed','apply the plan that is currently awaiting confirmation'
 ],
 18: [
  'please open Chrome search results for <query>','search the internet about <query> for me','bring up a Google search concerning <query>','I need to look <query> up on the web','find web results relating to <query>','open a search page about <query> in my browser','can you search online about <query>','look for information on <query> through the browser','take me to web search results for <query>','run an internet search for <query>','please look <query> up using Chrome','open the web to search for <query>'
 ],
 19: [
  'run the approved test recipe on project demo','execute project demo using its configured build recipe','start the registered build workflow for project demo','please launch the approved demo test command','use the configured recipe to test project demo','run demo through its saved build workflow','perform the registered build task in project demo','launch the configured test run for the demo project','execute the approved build recipe belonging to demo','start a managed test recipe in demo','run the saved project demo build command','please invoke demo project recipe test'
 ],
 20: [
  'show me an inventory of the open iTerm sessions','let me review the current terminal tabs','list the windows and sessions inside iTerm','which iTerm terminal windows are open','read out my existing terminal session names','bring up the terminal session inventory','display the iTerm tabs currently available','tell me what terminal sessions exist','show the current iTerm window list','I want to inspect the open terminal sessions','give me the list of tabs in iTerm','list the terminal windows that are already running'
 ],
 21: [
  'please stop the owned terminal execution <title>','cancel my running managed job named <title>','abort the registered recipe run called <title>','end the active terminal recipe job <title>','terminate the managed command job <title>','stop the recipe execution with job ID <title>','halt my owned terminal run <title>','please cancel the current recipe job <title>','I want to stop managed terminal job <title>','abort the background recipe run named <title>','cancel execution of the owned job <title>','terminate my configured terminal job <title>'
 ],
 22: [
  'please prepare a Claude request about <prompt>','propose asking Codex to help with <prompt>','I would like to ask ChatGPT <prompt>','create a proposed request to Claude for <prompt>','get a request ready for Codex concerning <prompt>','ask the ChatGPT service about <prompt>','prepare the prompt <prompt> for Claude','I want to consult Codex about <prompt>','please propose sending <prompt> to ChatGPT','get Claude ready to answer <prompt>','make a request proposal for ChatGPT about <prompt>','prepare to consult the Codex service on <prompt>'
 ],
 23: [
  'let me review the external AI responses','show me the output from completed provider jobs','read back what ChatGPT returned','which answers came back from the external assistants','display the results of my provider requests','bring up the verified Codex responses','what did the external services answer','give me the returned results from Claude','read the completed external job receipts','show my existing external assistant results','list the verified responses from provider jobs','let me see what my external requests produced'
 ],
 24: [
  'show me the task records from the secretary source','retrieve the calendar snapshot in Personal Secretary','read the notes stored in the source secretary app','bring up reminders from my Personal Secretary source','display the source application task collection','give me the imported notes from Personal Secretary','read the calendar data from the secretary snapshot','show the reminder records in the connected secretary source','get the task snapshot in the source application','let me review Personal Secretary source notes','retrieve the reminders in the secretary data snapshot','display the source Personal Secretary calendar collection'
 ],
 25: [
  'tell me the kinds of commands you support','how can this assistant help me','give me an explanation of your functions','show me what operations are available','I need help making a request','describe what I can ask this app to do','what features does the assistant provide','can you explain the supported request types','tell me how to interact with this assistant','what commands should I use here','give me a quick guide to your abilities','help me understand the available capabilities'
 ],
 26: [
  'please report whether the core is ready','are your local adapters working','check the operational health of this assistant','tell me the current service status','is my assistant connected to the local core','show me whether your services are running','give me a readiness check for the core','report the state of the connected adapters','how healthy is the local assistant service','let me see the core connection status','are the assistant services available now','check if the local core is operational'
 ]
};

export const additionalNegativeTests = [
 'explain how insulin works','what should I do about a persistent fever','is this mushroom edible','what causes an irregular heartbeat','interpret this blood test','how does a vaccine protect someone','recommend treatment for a sprained ankle','what is the difference between a virus and bacteria','explain what an MRI measures','tell me the side effects of this medicine',
 'prepare my tax return','tell me whether this contract is enforceable','predict the price of gold','which investment should I buy','calculate the tax on a house sale','write a legal complaint for me','explain my insurance coverage','file for a business license','choose a mortgage lender','check the status of my court case',
 'turn the bedroom lights off','set the thermostat to twenty degrees','start my robot vacuum','unlock the front door','connect to the office VPN','change my mouse sensitivity','increase the speaker volume','rotate the display to portrait','pair a new keyboard','enable airplane mode',
 'send a WhatsApp message to Sam','post the notes to the team channel','join a video call automatically','record this phone conversation','send a voice note to my manager','answer my unread emails','add all coworkers to a contact group','find the address of my oldest contact','send invitations to my birthday party','share my entire photo library',
 'delete every completed task permanently','erase the whole calendar database','run curl and upload my token file','execute rm on the home folder','grant this process administrator access','disable your request validation','approve all future Claude requests automatically','switch off the firewall before starting','reveal the contents of the local pairing token','install software from this unknown attachment',
 'play a podcast about calendars','skip the current music track','choose a film for tonight','shuffle my music library','make a playlist for running','find subtitles for this video','start a live radio station','download an audiobook','cast this movie to the television','change the playback speed in my media player',
 'order a replacement charging cable','renew my vehicle registration','purchase a gift card','subscribe to this online newspaper','pay for an airport taxi','make a donation using my card','send a refund to my customer','reserve a seat on the next flight','place a food delivery order','buy the cheapest available laptop',
 'my task was completed by someone else','we cancelled the appointment last month','he told me that the reminder had fired','the instructions say to add a note','this paragraph contains the words schedule meeting','I remember when my calendar was empty','my browser showed a search for basil','the terminal job finished before I arrived','the story says that she deleted the reminder','the email reports that a task was added',
 'do not create a reminder for me','please never cancel that meeting','do not mark my tasks as complete','I do not want a new note','never run a project recipe on my behalf','please do not open a web search','do not send anything to ChatGPT','I am asking you not to apply the plan','never change the date of my appointment','please do not snooze any reminders',
 'what would happen if I cancelled my meeting','suppose I had already completed the task','imagine scheduling a meeting on Mars','if a reminder were deleted could it return','would a task list help a fictional character','I am quoting the phrase cancel meeting Review','someone wrote add task Pay rent on this sign','in a hypothetical app how would you apply a plan','consider a story in which the assistant runs a terminal command','I am reporting that someone searched the web'
];
