import logging
from services import TaskService

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

if __name__ == "__main__":
    test_inputs = [
        "αυριο δουλεια στο passenger 22:00 μην ξεχάσεις την κονσόλα και τα καλώδια μεθαρυιο δουλεία στο estrella να έχεις βάλει τα ρόυχα για πλήσιμο μέρι τότε.",
    ]
    
    service = TaskService()
    
    for test_input in test_inputs:
        print("\n" + "=" * 50)
        try:
            saved_tasks = service.extract_and_save(test_input)
            
            print(f"EXTRACTION SUCCESS. Saved {len(saved_tasks)} tasks:\n")
            for task in saved_tasks:
                print(f"✓ [{task.category} | {task.priority}] {task.task_name} "
                      f"(due: {task.due_date} {task.due_time or ''}) [id: {task.record_id}]")
                print(f"  Description: {task.description}")
                if task.checklist:
                    print(f"  Checklist: {task.checklist}")
                print()
        except Exception as e:
            logging.error(f"Failed to process input: {e}")
            print("EXTRACTION FAILED. See logs above for details.")
        
        print("=" * 50 + "\n")